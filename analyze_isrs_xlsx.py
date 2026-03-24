#!/usr/bin/env python3
"""
Analýza exportu z Registru smluv (XLSX) bez web scrapingu.

Vstup: xlsx export z isrs.
Výstup:
- output/isrs_analysis.csv
- output/isrs_summary.txt
"""

from __future__ import annotations

import argparse
import difflib
import re
import unicodedata
from pathlib import Path

import pandas as pd


def normalize_text(value: str) -> str:
    text = unicodedata.normalize("NFD", str(value or ""))
    text = "".join(ch for ch in text if unicodedata.category(ch) != "Mn")
    return text.lower().strip()


def to_number(value) -> float | None:
    if pd.isna(value):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    s = str(value).strip().replace(" ", "").replace("\u00a0", "").replace(",", ".")
    if s == "" or "neuvedeno" in normalize_text(s):
        return None
    try:
        return float(s)
    except ValueError:
        return None


def base_contract_no(contract_no: str) -> str:
    """
    Z čísla typu '459/1S/2025/dodatek č. 3' vrátí '459/1S/2025'.
    """
    if not contract_no:
        return ""
    raw = str(contract_no).strip()
    norm = normalize_text(raw)
    idx = norm.find("/dodatek")
    return raw[:idx].strip() if idx >= 0 else raw


def find_navazne_columns(col_map: dict) -> list[str]:
    """
    Všechny sloupce, jejichž normalizovaný název obsahuje 'navaz' (např. ID návazné smlouvy).
    Excel může mít více sloupců se stejným významem.
    """
    out: list[str] = []
    for original, norm in col_map.items():
        if "navaz" in norm:
            out.append(original)
    return out


def extract_ids_from_cell(value) -> list[str]:
    """Z buňky exportu vytáhne číselná ID smluv."""
    if pd.isna(value):
        return []
    s = str(value).strip()
    if not s:
        return []
    parts = re.split(r"[;,\s/]+", s)
    ids: list[str] = []
    for p in parts:
        t = p.strip()
        if t.isdigit():
            ids.append(t)
    if not ids and s.isdigit():
        ids.append(s)
    return ids


def clean_subject_for_match(subject: str) -> str:
    """
    Očistí název pro porovnání podobnosti:
    - odstraní prefixy typu "Dodatek č. X ke ..."
    - normalizuje mezery
    """
    s = normalize_text(subject)
    s = re.sub(r"dodatek\s*c\.\s*\d+\s*ke\s*", "", s)
    s = re.sub(r"^dodatek\s*ke\s*", "", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def main() -> None:
    parser = argparse.ArgumentParser(description="Analýza ISRS exportu")
    parser.add_argument("--input", required=True, help="Cesta k XLSX exportu")
    parser.add_argument("--output-dir", default="output", help="Výstupní složka")
    parser.add_argument(
        "--min-base-price",
        type=float,
        default=500000.0,
        help="Minimální původní cena bez DPH pro zahrnutí do reportu",
    )
    parser.add_argument(
        "--force-heuristic",
        action="store_true",
        help="Ignorovat sloupce ID návaznosti a použít výhradně heuristické párování",
    )
    args = parser.parse_args()

    input_path = Path(args.input)
    out_dir = Path(args.output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    df = pd.read_excel(input_path)
    # Sjednotíme názvy sloupců bez diakritiky.
    col_map = {c: normalize_text(c) for c in df.columns}

    def get_col(needle: str) -> str:
        needle_n = normalize_text(needle)
        for original, norm in col_map.items():
            if norm == needle_n:
                return original
        raise KeyError(f"Nenalezen sloupec: {needle}")

    col_city = get_col("Publikující smluvní strana")
    col_subject = get_col("Textové označení smlouvy")
    col_url = get_col("Adresa záznamu")
    col_id = get_col("ID smlouvy")
    col_no = get_col("Číslo smlouvy / č. j.")
    col_price = get_col("Hodnota smlouvy bez DPH")
    col_party = get_col("Název protistrany č. 1")
    col_date = get_col("Datum uzavření")
    nav_cols = find_navazne_columns(col_map)
    use_id_pairing = bool(nav_cols) and not args.force_heuristic

    rows = []
    for _, r in df.iterrows():
        subject = str(r[col_subject] if not pd.isna(r[col_subject]) else "")
        subject_n = normalize_text(subject)
        # Přísnější filtr:
        # - původní kontrakt musí být explicitně "smlouva o dílo"
        # - dodatek musí obsahovat "dodatek" + odkaz na smlouvu o dílo
        is_base_sod = subject_n.startswith("smlouva o dilo")
        is_addendum_sod = ("dodatek" in subject_n and "smlouv" in subject_n and "o dilo" in subject_n)
        if not (is_base_sod or is_addendum_sod):
            continue

        linked_ids: list[str] = []
        for nc in nav_cols:
            linked_ids.extend(extract_ids_from_cell(r[nc]))

        rows.append(
            {
                "city": str(r[col_city]) if not pd.isna(r[col_city]) else "",
                "supplier": str(r[col_party]) if not pd.isna(r[col_party]) else "",
                "subject": subject,
                "contract_id": str(r[col_id]) if not pd.isna(r[col_id]) else "",
                "url": str(r[col_url]) if not pd.isna(r[col_url]) else "",
                "contract_no": str(r[col_no]) if not pd.isna(r[col_no]) else "",
                "price_no_vat": to_number(r[col_price]),
                "sign_date": str(r[col_date]) if not pd.isna(r[col_date]) else "",
                "is_addendum": is_addendum_sod,
                "linked_ids": linked_ids,
            }
        )

    data = pd.DataFrame(rows)
    if data.empty:
        (out_dir / "isrs_summary.txt").write_text("Bez dat po filtru smlouvy o dílo.", encoding="utf-8")
        return

    data["base_no"] = data["contract_no"].apply(base_contract_no)
    data["supplier_n"] = data["supplier"].apply(normalize_text)
    data["subject_match"] = data["subject"].apply(clean_subject_for_match)

    base_df = data[~data["is_addendum"]].copy()
    add_df = data[data["is_addendum"]].copy()

    merged_rows: list[dict] = []

    if use_id_pairing:
        # Deterministické párování: dodatek má v linked_ids ID kmenové smlouvy.
        add_records = add_df.to_dict("records")
        for _, base in base_df.iterrows():
            base_id = str(base["contract_id"] or "")
            selected = [
                a
                for a in add_records
                if base_id and base_id in (a.get("linked_ids") or [])
            ]
            match_method = "id-navaznost" if selected else "none"
            addenda_count = len(selected)
            addenda_with_value_count = sum(1 for a in selected if pd.notna(a.get("price_no_vat")))
            addenda_sum = float(sum(float(a.get("price_no_vat") or 0.0) for a in selected))
            row = base.to_dict()
            row["addenda_count"] = addenda_count
            row["addenda_with_value_count"] = addenda_with_value_count
            row["addenda_sum"] = addenda_sum
            row["match_method"] = match_method
            merged_rows.append(row)
    else:
        # 3úrovňové párování dodatků (heuristika):
        # 1) base_no + supplier + podobný název
        # 2) base_no + podobný název
        # 3) jen base_no (fallback)
        add_records = add_df.to_dict("records")
        used_add_ids: set[str] = set()

        for _, base in base_df.iterrows():
            base_no = str(base["base_no"] or "")
            base_supplier_n = str(base["supplier_n"] or "")
            base_subj = str(base["subject_match"] or "")

            candidates = [a for a in add_records if str(a.get("base_no") or "") == base_no]
            selected: list[dict] = []
            match_method = "none"

            if candidates:
                scored = []
                for a in candidates:
                    if a["contract_id"] in used_add_ids:
                        continue
                    sim = difflib.SequenceMatcher(
                        None, base_subj, str(a.get("subject_match") or "")
                    ).ratio()
                    supplier_ok = str(a.get("supplier_n") or "") == base_supplier_n and base_supplier_n != ""
                    score = sim + (0.35 if supplier_ok else 0.0)
                    scored.append((score, sim, supplier_ok, a))

                strong = [x for x in scored if x[1] >= 0.55 and x[2]]
                if strong:
                    selected = [x[3] for x in strong]
                    match_method = "no+supplier+subject"
                else:
                    mid = [x for x in scored if x[1] >= 0.65]
                    if mid:
                        selected = [x[3] for x in mid]
                        match_method = "no+subject"
                    else:
                        selected = [x[3] for x in scored]
                        match_method = "no-only"

            for a in selected:
                used_add_ids.add(a["contract_id"])

            addenda_count = len(selected)
            addenda_with_value_count = sum(1 for a in selected if pd.notna(a.get("price_no_vat")))
            addenda_sum = float(sum(float(a.get("price_no_vat") or 0.0) for a in selected))

            row = base.to_dict()
            row["addenda_count"] = addenda_count
            row["addenda_with_value_count"] = addenda_with_value_count
            row["addenda_sum"] = addenda_sum
            row["match_method"] = match_method
            merged_rows.append(row)

    merged = pd.DataFrame(merged_rows)
    merged["base_price"] = merged["price_no_vat"].fillna(0.0)
    merged["final_price"] = merged["base_price"] + merged["addenda_sum"]
    merged["sign_date_dt"] = pd.to_datetime(merged["sign_date"], dayfirst=True, errors="coerce")
    merged["year"] = merged["sign_date_dt"].dt.year
    merged["delta_pct"] = merged.apply(
        lambda x: ((x["final_price"] - x["base_price"]) / x["base_price"] * 100.0)
        if x["base_price"] != 0
        else None,
        axis=1,
    )
    # Klíčový filtr proti zkreslení malými zakázkami.
    merged = merged[merged["base_price"] >= float(args.min_base_price)].copy()

    out = merged[
        [
            "city",
            "supplier",
            "subject",
            "contract_id",
            "url",
            "base_price",
            "addenda_count",
            "addenda_with_value_count",
            "addenda_sum",
            "final_price",
            "delta_pct",
            "match_method",
            "sign_date",
            "year",
        ]
    ].rename(
        columns={
            "city": "Město",
            "supplier": "Smluvní strana",
            "subject": "Název smlouvy",
            "contract_id": "ID původní smlouvy",
            "url": "URL původní smlouvy",
            "base_price": "Původní cena bez DPH",
            "addenda_count": "Počet dodatků",
            "addenda_with_value_count": "Počet dodatků s cenou",
            "addenda_sum": "Součet hodnot dodatků bez DPH",
            "final_price": "Cena po dodatcích bez DPH",
            "delta_pct": "Změna %",
            "match_method": "Metoda párování",
            "sign_date": "Datum uzavření",
            "year": "Rok",
        }
    )

    out = out.sort_values(by="Změna %", ascending=False, na_position="last")
    out.to_csv(out_dir / "isrs_analysis.csv", index=False, encoding="utf-8-sig")

    valid = out["Změna %"].dropna()
    avg = float(valid.mean()) if not valid.empty else 0.0
    pairing_mode = (
        "deterministické (sloupce návaznosti)"
        if use_id_pairing
        else "heuristické (č. j. + název)"
    )
    summary = [
        f"Soubor: {input_path.name}",
        f"Režim párování: {pairing_mode}",
        f"Sloupce návaznosti v souboru: {len(nav_cols)}",
        f"Řádků po filtru smlouva o dílo: {len(data)}",
        f"Minimální původní cena bez DPH: {args.min_base_price:.0f} Kč",
        f"Původních SOD: {len(base_df)}",
        f"Dodatků k SOD: {len(add_df)}",
        f"SOD po cenovém filtru: {len(out)}",
        f"Průměrná změna po dodatcích: {avg:.2f} %",
    ]
    (out_dir / "isrs_summary.txt").write_text("\n".join(summary), encoding="utf-8")
    print("\n".join(summary))


if __name__ == "__main__":
    main()
