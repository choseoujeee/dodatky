#!/usr/bin/env python3
"""
Scraper Registru smluv pro analýzu dodatků ke smlouvám o dílo.

Výstupy:
- output/raw_records.csv       (1 řádek = 1 záznam smlouvy/dodatku)
- output/sod_analysis.csv      (1 řádek = 1 původní smlouva o dílo + souhrn dodatků)
- output/summary.txt           (agregace pro rychlé argumenty)
"""

from __future__ import annotations

import argparse
import csv
import concurrent.futures
import re
import time
import unicodedata
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional
import requests
from bs4 import BeautifulSoup

BASE_URL = "https://smlouvy.gov.cz"
SEARCH_URL = f"{BASE_URL}/vyhledavani"
DEFAULT_UA = "Mozilla/5.0 (compatible; RegistrScrape/1.0)"
CONSTRUCTION_KEYWORDS = [
    "staveb",
    "rekonstruk",
    "vystavb",
    "komunikac",
    "chodnik",
    "kanaliz",
    "vodovod",
    "vod ",
    "budov",
    "objekt",
    "fasad",
    "zateplen",
    "demolic",
]


def normalize_text(value: str) -> str:
    """Normalizuje text pro robustní fulltext filtr (bez diakritiky, lower)."""
    txt = unicodedata.normalize("NFD", value or "")
    txt = "".join(ch for ch in txt if unicodedata.category(ch) != "Mn")
    return txt.lower()


@dataclass
class RawRecord:
    url: str
    city: str
    supplier: str
    subject: str
    contract_id: str
    parent_contract_id: str
    linked_contract_ids: str
    contract_no: str
    sign_date: str
    amount_no_vat_text: str
    amount_no_vat: Optional[float]
    amount_vat_text: str
    amount_vat: Optional[float]
    is_addendum: bool


def fetch_html(session: requests.Session, url: str, timeout_s: int = 30) -> str:
    """Stáhne HTML stránky. Při neúspěchu vyhodí výjimku."""
    response = session.get(url, timeout=timeout_s)
    response.raise_for_status()
    # U webu se může lišit deklarované a reálné kódování; použijeme detekci.
    response.encoding = response.apparent_encoding or response.encoding
    return response.text


def extract_label_values(lines: List[str], label: str) -> List[str]:
    """Vrátí všechny hodnoty pro label (inline i na následujícím řádku)."""
    out: List[str] = []
    prefix = f"{normalize_text(label)}:"
    norm_lines = [normalize_text(line) for line in lines]

    for i, norm_line in enumerate(norm_lines):
        if not norm_line.startswith(prefix):
            continue

        raw_line = lines[i]
        after_colon = raw_line.split(":", 1)[1].strip() if ":" in raw_line else ""
        if after_colon:
            out.append(after_colon)
            continue

        # Některé detaily mají hodnotu až na dalším řádku.
        next_val = ""
        for j in range(i + 1, len(lines)):
            candidate = lines[j].strip()
            if candidate:
                next_val = candidate
                break
        if next_val:
            out.append(next_val)
    return out


def extract_first(lines: List[str], label: str) -> str:
    """Vrátí první hodnotu pro daný label, nebo prázdný string."""
    vals = extract_label_values(lines, label)
    return vals[0] if vals else ""


def parse_czk_number(raw: str) -> Optional[float]:
    """Převede český formát čísla na float. Nečíselná/prázdná hodnota -> None."""
    s = (raw or "").strip()
    if not s:
        return None
    if "cena neuvedena" in s.lower():
        return None
    cleaned = (
        s.replace("CZK", "")
        .replace(" ", "")
        .replace("\u00a0", "")
        .replace(".", "")
        .replace(",", ".")
    )
    try:
        return float(cleaned)
    except ValueError:
        return None


def parse_contract_detail(html: str, url: str) -> Optional[RawRecord]:
    """Vyparsuje detail smlouvy/dodatku do RawRecord."""
    soup = BeautifulSoup(html, "html.parser")
    text_lines = [line.strip() for line in soup.get_text("\n").splitlines() if line.strip()]

    city = extract_first(text_lines, "nazev subjektu")
    subject = extract_first(text_lines, "predmet smlouvy")
    contract_id = extract_first(text_lines, "id smlouvy")
    contract_no = extract_first(text_lines, "cislo smlouvy / c.j.")
    sign_date = extract_first(text_lines, "datum uzavreni")
    amount_no_vat_text = extract_first(text_lines, "hodnota bez dph")
    amount_vat_text = extract_first(text_lines, "hodnota vc. dph")

    # "Název:" se objevuje minimálně 2x (město a pak smluvní strana)
    all_names = extract_label_values(text_lines, "nazev")
    supplier = all_names[1] if len(all_names) > 1 else ""

    parent_contract_id = extract_first(text_lines, "id navazne smlouvy")
    linked_contract_ids = "|".join(extract_label_values(text_lines, "id navazne smlouvy"))

    if not contract_id:
        return None

    return RawRecord(
        url=url,
        city=city,
        supplier=supplier,
        subject=subject,
        contract_id=contract_id,
        parent_contract_id=parent_contract_id,
        linked_contract_ids=linked_contract_ids,
        contract_no=contract_no,
        sign_date=sign_date,
        amount_no_vat_text=amount_no_vat_text,
        amount_no_vat=parse_czk_number(amount_no_vat_text),
        amount_vat_text=amount_vat_text,
        amount_vat=parse_czk_number(amount_vat_text),
        is_addendum=bool(re.search(r"\bdodatek\b", subject or "", flags=re.IGNORECASE)),
    )


def collect_detail_urls(session: requests.Session, city_query: str, max_pages: int, sleep_s: float) -> List[str]:
    """Projede výsledky přes AJAX snippety a vrátí unikátní URL detailů smluv."""
    # Registr smluv vrací tabulku výsledků přes nette.ajax (nikoli přímo v HTML stránky).
    # Proto nejdřív navážeme session na /vyhledavani.
    session.get(SEARCH_URL, timeout=30)

    base_params = {
        "publication_date[from]": "",
        "publication_date[to]": "",
        "subject_name": city_query,
        "subject_box": "",
        "subject_idnum": "",
        "subject_address": "",
        "value_foreign[from]": "",
        "value_foreign[to]": "",
        "foreign_currency": "",
        "contract_reference_number": "",
        "contract_id": "",
        "party_name": "",
        "party_box": "",
        "party_idnum": "",
        "party_address": "",
        "value_no_vat[from]": "",
        "value_no_vat[to]": "",
        "file_text": "",
        "version_id": "",
        "contr_num": "",
        "sign_date[from]": "",
        "sign_date[to]": "",
        "contract_descr": "",
        "sign_person_name": "",
        "value_vat[from]": "",
        "value_vat[to]": "",
        "search_type": "0",  # jen poslední verze
    }

    ajax_headers = {"X-Requested-With": "XMLHttpRequest"}

    def request_snippet(params: Dict[str, str]) -> str:
        resp = session.get(SEARCH_URL, params=params, headers=ajax_headers, timeout=30)
        resp.raise_for_status()
        payload = resp.json()
        return payload.get("snippets", {}).get("snippet-searchResultList-list", "")

    # 1) inicializační vyhledání
    init_params = dict(base_params)
    init_params.update({"do": "detailedSearchForm-submit", "search": "Vyhledat"})
    snippet = request_snippet(init_params)
    if not snippet:
        return []

    # 2) zvýšíme page size na 500 (méně requestů)
    limit_params = dict(base_params)
    limit_params.update({"do": "searchResultList-setLimit", "searchResultList-limit": "500"})
    snippet = request_snippet(limit_params) or snippet

    seen: Dict[str, bool] = {}
    result: List[str] = []

    def extract_detail_urls(snippet_html: str) -> int:
        added_local = 0
        soup = BeautifulSoup(snippet_html, "html.parser")
        for row in soup.select("table.searchResultList tbody tr"):
            cells = row.find_all("td")
            subject_cell = cells[1] if len(cells) > 1 else None
            detail_link = row.select_one("td.btn a[href]")
            if not subject_cell or not detail_link:
                continue

            subject = normalize_text(subject_cell.get_text(" ", strip=True))
            # Primární filtr: tvary typu "smlouva/smlouvy/smlouvě ... o dílo".
            if "smlouv" not in subject or "o dilo" not in subject:
                continue

            # Dodatky k SOD bereme vždy (často mají stručný název bez technických klíčových slov).
            if "dodatek" in subject:
                pass
            # U původních smluv filtrujeme jen stavebně-rekonstrukční témata.
            elif not any(k in subject for k in CONSTRUCTION_KEYWORDS):
                continue

            rel = detail_link["href"]
            url = f"{BASE_URL}{str(rel).split('?')[0]}"
            if url not in seen:
                seen[url] = True
                result.append(url)
                added_local += 1
        return added_local

    extract_detail_urls(snippet)

    # 3) stránkujeme přes offset (0, 500, 1000, ...)
    for page in range(1, max_pages):
        offset = page * 500
        offset_params = dict(base_params)
        offset_params.update(
            {
                "do": "searchResultList-setOffset",
                "searchResultList-offset": str(offset),
                "searchResultList-limit": "500",
            }
        )
        sn = request_snippet(offset_params)
        added = extract_detail_urls(sn)
        if added == 0:
            break
        time.sleep(sleep_s)

    return result


def build_analysis(raw_records: List[RawRecord]) -> List[dict]:
    """Vytvoří řádky analýzy pro původní smlouvy o dílo + dodatky."""
    addenda_by_parent: Dict[str, List[RawRecord]] = {}
    for rec in raw_records:
        if rec.is_addendum and rec.parent_contract_id:
            addenda_by_parent.setdefault(rec.parent_contract_id, []).append(rec)

    rows: List[dict] = []
    for base in raw_records:
        if base.is_addendum:
            continue
        subj_norm = normalize_text(base.subject or "")
        if "smlouv" not in subj_norm or "o dilo" not in subj_norm:
            continue

        base_amount = float(base.amount_no_vat or 0.0)
        addenda = addenda_by_parent.get(base.contract_id, [])
        addenda_with_value = [a for a in addenda if a.amount_no_vat is not None]
        addenda_sum = sum(float(a.amount_no_vat) for a in addenda_with_value)

        final_amount = base_amount + addenda_sum
        delta_pct = ((final_amount - base_amount) / base_amount * 100.0) if base_amount else None

        rows.append(
            {
                "Město": base.city,
                "Smluvní strana": base.supplier,
                "Název smlouvy": base.subject,
                "ID původní smlouvy": base.contract_id,
                "URL původní smlouvy": base.url,
                "Původní cena bez DPH": round(base_amount, 2),
                "Počet dodatků": len(addenda),
                "Počet dodatků s cenou": len(addenda_with_value),
                "Součet hodnot dodatků bez DPH": round(addenda_sum, 2),
                "Cena po dodatcích bez DPH": round(final_amount, 2),
                "Změna %": round(delta_pct, 4) if delta_pct is not None else "",
            }
        )

    rows.sort(
        key=lambda x: (float(x["Změna %"]) if x["Změna %"] != "" else -999999),
        reverse=True,
    )
    return rows


def write_csv(path: Path, headers: List[str], rows: List[dict]) -> None:
    """Zapíše seznam dict řádků do CSV se zadanými hlavičkami."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=headers, extrasaction="ignore")
        writer.writeheader()
        for row in rows:
            writer.writerow(row)


def main() -> None:
    parser = argparse.ArgumentParser(description="Scraper Registru smluv - smlouvy o dílo + dodatky")
    parser.add_argument("--city", default="město kopřivnice", help="Název publikujícího subjektu")
    parser.add_argument("--max-pages", type=int, default=20, help="Max počet stránek vyhledávání")
    parser.add_argument("--sleep", type=float, default=0.15, help="Pauza mezi requesty v sekundách")
    parser.add_argument("--output-dir", default="output", help="Výstupní složka")
    args = parser.parse_args()

    out_dir = Path(args.output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    session = requests.Session()
    session.headers.update({"User-Agent": DEFAULT_UA})

    detail_urls = collect_detail_urls(session, args.city, args.max_pages, args.sleep)
    raw_records: List[RawRecord] = []

    def fetch_and_parse(url: str) -> Optional[RawRecord]:
        """Stáhne detail a vrátí parsovaný záznam; při chybě vrací None."""
        try:
            local_session = requests.Session()
            local_session.headers.update({"User-Agent": DEFAULT_UA})
            html = fetch_html(local_session, url)
            return parse_contract_detail(html, url)
        except Exception:
            return None

    # Paralelní stahování výrazně zrychlí běh pro stovky detailů.
    with concurrent.futures.ThreadPoolExecutor(max_workers=12) as executor:
        futures = [executor.submit(fetch_and_parse, url) for url in detail_urls]
        for idx, future in enumerate(concurrent.futures.as_completed(futures), start=1):
            rec = future.result()
            if rec:
                raw_records.append(rec)
            if idx % 50 == 0:
                print(f"Zpracováno {idx}/{len(detail_urls)} detailů...")

    raw_rows = [
        {
            "URL": r.url,
            "Město": r.city,
            "Smluvní strana": r.supplier,
            "Předmět smlouvy": r.subject,
            "Je dodatek": "ANO" if r.is_addendum else "NE",
            "ID smlouvy": r.contract_id,
            "ID návazné smlouvy": r.parent_contract_id,
            "Navázané ID (záznam)": r.linked_contract_ids,
            "Číslo smlouvy / č.j.": r.contract_no,
            "Datum uzavření": r.sign_date,
            "Hodnota bez DPH text": r.amount_no_vat_text,
            "Hodnota bez DPH číslo": "" if r.amount_no_vat is None else round(r.amount_no_vat, 2),
            "Hodnota vč. DPH text": r.amount_vat_text,
            "Hodnota vč. DPH číslo": "" if r.amount_vat is None else round(r.amount_vat, 2),
        }
        for r in raw_records
    ]

    analysis_rows = build_analysis(raw_records)

    write_csv(
        out_dir / "raw_records.csv",
        [
            "URL",
            "Město",
            "Smluvní strana",
            "Předmět smlouvy",
            "Je dodatek",
            "ID smlouvy",
            "ID návazné smlouvy",
            "Navázané ID (záznam)",
            "Číslo smlouvy / č.j.",
            "Datum uzavření",
            "Hodnota bez DPH text",
            "Hodnota bez DPH číslo",
            "Hodnota vč. DPH text",
            "Hodnota vč. DPH číslo",
        ],
        raw_rows,
    )

    write_csv(
        out_dir / "sod_analysis.csv",
        [
            "Město",
            "Smluvní strana",
            "Název smlouvy",
            "ID původní smlouvy",
            "URL původní smlouvy",
            "Původní cena bez DPH",
            "Počet dodatků",
            "Počet dodatků s cenou",
            "Součet hodnot dodatků bez DPH",
            "Cena po dodatcích bez DPH",
            "Změna %",
        ],
        analysis_rows,
    )

    valid = [r for r in analysis_rows if r["Změna %"] != ""]
    avg_pct = (sum(float(r["Změna %"]) for r in valid) / len(valid)) if valid else 0.0

    summary = [
        f"Subjekt: {args.city}",
        f"Počet detailů (raw): {len(raw_records)}",
        f"Počet původních SOD v analýze: {len(analysis_rows)}",
        f"Průměrná změna po dodatcích: {avg_pct:.2f} %",
    ]
    (out_dir / "summary.txt").write_text("\n".join(summary), encoding="utf-8")

    print("Hotovo.")
    for line in summary:
        print(line)


if __name__ == "__main__":
    main()
