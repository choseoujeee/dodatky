#!/usr/bin/env python3
"""
Vytvoří HTML board report z výstupu isrs_analysis.csv.
"""

from __future__ import annotations

import argparse
import json
from datetime import datetime
from pathlib import Path

import pandas as pd


def fmt_money(v: float) -> str:
    return f"{v:,.0f}".replace(",", " ") + " Kč"


def fmt_pct(v: float) -> str:
    return f"{v:.2f} %"


def method_label(v: str) -> str:
    m = (v or "").strip()
    return {
        "no+supplier+subject": "Číslo + dodavatel + podobnost názvu",
        "no+subject": "Číslo + podobnost názvu",
        "no-only": "Pouze číslo smlouvy",
        "none": "Bez dodatků",
    }.get(m, m)


def html_table(df: pd.DataFrame, cols: list[str]) -> str:
    if df.empty:
        return "<p class='muted'>Bez dat.</p>"
    sub = df[cols].copy()
    return sub.to_html(index=False, classes="tbl", border=0, escape=False)


def main() -> None:
    parser = argparse.ArgumentParser(description="Board HTML report")
    parser.add_argument("--input", default="output/isrs_analysis.csv")
    parser.add_argument("--output", default="output/board-report.html")
    parser.add_argument("--min-base-price", type=float, default=500000.0)
    args = parser.parse_args()

    in_path = Path(args.input)
    out_path = Path(args.output)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    df = pd.read_csv(in_path)
    if df.empty:
        out_path.write_text("<h1>Bez dat</h1>", encoding="utf-8")
        return

    # Normalizace
    df["Počet dodatků"] = pd.to_numeric(df["Počet dodatků"], errors="coerce").fillna(0).astype(int)
    df["Součet hodnot dodatků bez DPH"] = pd.to_numeric(df["Součet hodnot dodatků bez DPH"], errors="coerce").fillna(0.0)
    df["Původní cena bez DPH"] = pd.to_numeric(df["Původní cena bez DPH"], errors="coerce").fillna(0.0)
    df["Cena po dodatcích bez DPH"] = pd.to_numeric(df["Cena po dodatcích bez DPH"], errors="coerce").fillna(0.0)
    df["Změna %"] = pd.to_numeric(df["Změna %"], errors="coerce")
    df["Rok"] = pd.to_numeric(df.get("Rok"), errors="coerce")
    df = df[df["Původní cena bez DPH"] >= float(args.min_base_price)].copy()
    if df.empty:
        out_path.write_text("<h1>Po cenovém filtru nejsou dostupná data.</h1>", encoding="utf-8")
        return

    total = len(df)
    with_add = int((df["Počet dodatků"] > 0).sum())
    share_with_add = (with_add / total * 100.0) if total else 0.0
    avg_change = float(df["Změna %"].dropna().mean()) if df["Změna %"].notna().any() else 0.0
    median_change = float(df["Změna %"].dropna().median()) if df["Změna %"].notna().any() else 0.0
    total_base = float(df["Původní cena bez DPH"].sum())
    total_add = float(df["Součet hodnot dodatků bez DPH"].sum())
    weighted_change = ((total_add / total_base) * 100.0) if total_base else 0.0
    add_only = df[df["Počet dodatků"] > 0].copy()
    add_only_avg_change = float(add_only["Změna %"].dropna().mean()) if not add_only.empty else 0.0
    add_only_avg_addenda_count = float(add_only["Počet dodatků"].mean()) if not add_only.empty else 0.0
    add_only_plus = int((add_only["Součet hodnot dodatků bez DPH"] > 0).sum()) if not add_only.empty else 0
    add_only_minus = int((add_only["Součet hodnot dodatků bez DPH"] < 0).sum()) if not add_only.empty else 0

    by_method = (
        df.groupby("Metoda párování", dropna=False)
        .size()
        .reset_index(name="Počet smluv")
        .sort_values("Počet smluv", ascending=False)
    )
    by_method["Metoda párování"] = by_method["Metoda párování"].map(method_label)

    top_up = df[df["Počet dodatků"] > 0].sort_values("Změna %", ascending=False).head(12).copy()
    top_down = df[df["Počet dodatků"] > 0].sort_values("Změna %", ascending=True).head(12).copy()

    for tdf in [top_up, top_down]:
        tdf["Původní cena bez DPH"] = tdf["Původní cena bez DPH"].map(fmt_money)
        tdf["Součet hodnot dodatků bez DPH"] = tdf["Součet hodnot dodatků bez DPH"].map(fmt_money)
        tdf["Cena po dodatcích bez DPH"] = tdf["Cena po dodatcích bez DPH"].map(fmt_money)
        tdf["Změna %"] = tdf["Změna %"].map(lambda x: fmt_pct(float(x)) if pd.notna(x) else "—")

    board_date = datetime.now().strftime("%d.%m.%Y %H:%M")
    # KPI po letech 2022-2025 pro dodatkované smlouvy
    yearly_blocks = []
    for year in [2022, 2023, 2024, 2025]:
        ydf = add_only[add_only["Rok"] == year] if "Rok" in add_only.columns else add_only.iloc[0:0]
        y_count = len(ydf)
        y_avg_add = float(ydf["Počet dodatků"].mean()) if y_count else 0.0
        y_plus = int((ydf["Součet hodnot dodatků bez DPH"] > 0).sum()) if y_count else 0
        y_minus = int((ydf["Součet hodnot dodatků bez DPH"] < 0).sum()) if y_count else 0
        y_avg_change = float(ydf["Změna %"].dropna().mean()) if y_count else 0.0
        yearly_blocks.append(
            f"""
            <div class="card">
              <div class="kpi-title">Rok {year} - dodatkované smlouvy</div>
              <div class="muted">Počet smluv: <strong>{y_count}</strong></div>
              <div class="muted">Průměrný počet dodatků: <strong>{y_avg_add:.2f}</strong></div>
              <div class="muted">Celkově + : <strong>{y_plus}</strong> | celkově - : <strong>{y_minus}</strong></div>
              <div class="muted">Průměrná změna (jen dodatkované): <strong>{fmt_pct(y_avg_change)}</strong></div>
            </div>
            """
        )

    # Dataset pro interaktivní tabulku
    table_cols = [
        "Město", "Smluvní strana", "Název smlouvy", "ID původní smlouvy", "URL původní smlouvy",
        "Datum uzavření", "Rok", "Původní cena bez DPH", "Počet dodatků",
        "Součet hodnot dodatků bez DPH", "Cena po dodatcích bez DPH", "Změna %", "Metoda párování"
    ]
    df_table = df[table_cols].copy()
    df_table["Původní cena bez DPH"] = df_table["Původní cena bez DPH"].round(2)
    df_table["Součet hodnot dodatků bez DPH"] = df_table["Součet hodnot dodatků bez DPH"].round(2)
    df_table["Cena po dodatcích bez DPH"] = df_table["Cena po dodatcích bez DPH"].round(2)
    df_table["Změna %"] = df_table["Změna %"].round(4)
    table_json = json.dumps(df_table.fillna("").to_dict(orient="records"), ensure_ascii=False)

    html = f"""<!doctype html>
<html lang="cs">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Board Report - Registr smluv (Kopřivnice)</title>
  <style>
    :root {{
      --bg:#f5f7fb; --card:#ffffff; --text:#0f172a; --muted:#475569;
      --primary:#0b3b6f; --ok:#0a7d35; --warn:#b45309; --bad:#b91c1c; --line:#dbe2ea;
    }}
    * {{ box-sizing:border-box; }}
    body {{ margin:0; font-family:Segoe UI, Arial, sans-serif; background:var(--bg); color:var(--text); }}
    .wrap {{ max-width:1200px; margin:0 auto; padding:28px; }}
    .hero {{ background:linear-gradient(135deg,#0b3b6f,#124f91); color:#fff; padding:24px 26px; border-radius:14px; }}
    .hero h1 {{ margin:0 0 8px; font-size:30px; }}
    .hero p {{ margin:4px 0; opacity:.95; }}
    .grid {{ display:grid; grid-template-columns:repeat(4,1fr); gap:14px; margin-top:18px; }}
    .card {{ background:var(--card); border:1px solid var(--line); border-radius:12px; padding:16px; }}
    .kpi-title {{ font-size:12px; text-transform:uppercase; color:var(--muted); letter-spacing:.4px; }}
    .kpi-value {{ margin-top:6px; font-size:30px; font-weight:700; }}
    .section {{ margin-top:18px; }}
    h2 {{ font-size:20px; margin:0 0 12px; }}
    .muted {{ color:var(--muted); }}
    .tbl {{ width:100%; border-collapse:collapse; background:#fff; border:1px solid var(--line); border-radius:10px; overflow:hidden; }}
    .tbl th,.tbl td {{ text-align:left; padding:10px 12px; border-bottom:1px solid var(--line); font-size:14px; vertical-align:top; }}
    .tbl th {{ background:#eef3f9; font-weight:600; }}
    .pill {{ display:inline-block; padding:3px 8px; border-radius:999px; font-size:12px; }}
    .ok {{ background:#e8f7ed; color:var(--ok); }}
    .warn {{ background:#fff4e5; color:var(--warn); }}
    .bad {{ background:#fdeaea; color:var(--bad); }}
    .foot {{ margin-top:16px; color:var(--muted); font-size:12px; }}
    @media (max-width:980px) {{ .grid {{ grid-template-columns:repeat(2,1fr); }} }}
    @media (max-width:620px) {{ .grid {{ grid-template-columns:1fr; }} }}
  </style>
</head>
<body>
  <div class="wrap">
    <div class="hero">
      <h1>Registr smluv - analytický report pro board</h1>
      <p>Město Kopřivnice | smlouvy o dílo + dodatky</p>
      <p>Filtr: původní cena bez DPH ≥ {fmt_money(float(args.min_base_price))}</p>
      <p>Generováno: {board_date}</p>
    </div>

    <div class="grid">
      <div class="card"><div class="kpi-title">Původní smlouvy o dílo</div><div class="kpi-value">{total}</div></div>
      <div class="card"><div class="kpi-title">Smlouvy s dodatkem</div><div class="kpi-value">{with_add}</div><div class="muted">{fmt_pct(share_with_add)}</div></div>
      <div class="card"><div class="kpi-title">Průměrná změna ceny</div><div class="kpi-value">{fmt_pct(avg_change)}</div><div class="muted">medián: {fmt_pct(median_change)}</div></div>
      <div class="card"><div class="kpi-title">Vážená změna ceny</div><div class="kpi-value">{fmt_pct(weighted_change)}</div><div class="muted">součet dodatků / součet původních cen</div></div>
    </div>
    <div class="grid">
      <div class="card"><div class="kpi-title">Dodatkované smlouvy - průměrný počet dodatků</div><div class="kpi-value">{add_only_avg_addenda_count:.2f}</div></div>
      <div class="card"><div class="kpi-title">Dodatkované smlouvy - celkově +</div><div class="kpi-value">{add_only_plus}</div></div>
      <div class="card"><div class="kpi-title">Dodatkované smlouvy - celkově -</div><div class="kpi-value">{add_only_minus}</div></div>
      <div class="card"><div class="kpi-title">Průměrná změna jen z dodatkovaných</div><div class="kpi-value">{fmt_pct(add_only_avg_change)}</div></div>
    </div>

    <div class="section">
      <h2>Roční rozpad (jen dodatkované smlouvy)</h2>
      <div class="grid">
        {''.join(yearly_blocks)}
      </div>
    </div>

    <div class="section card">
      <h2>Executive message</h2>
      <p>
        Dodatky u smluv o dílo jsou v datech standardní jev: dodatky se objevují u části kontraktů,
        ale agregovaně nevytvářejí dramatický skok ceny. V tomto datasetu vychází průměrná změna
        <strong>{fmt_pct(avg_change)}</strong>, váženě <strong>{fmt_pct(weighted_change)}</strong>.
      </p>
    </div>

    <div class="section card">
      <h2>Kvalita párování dodatků</h2>
      {html_table(by_method, ["Metoda párování", "Počet smluv"])}
      <p class="muted">Párování běží primárně přes číslo smlouvy/č.j. + dodavatel + podobnost názvu, s fallbackem na samotné číslo.</p>
    </div>

    <div class="section card">
      <h2>TOP navýšení po dodatcích</h2>
      {html_table(top_up, ["Název smlouvy","Počet dodatků","Původní cena bez DPH","Součet hodnot dodatků bez DPH","Cena po dodatcích bez DPH","Změna %","Metoda párování"])}
    </div>

    <div class="section card">
      <h2>TOP snížení po dodatcích</h2>
      {html_table(top_down, ["Název smlouvy","Počet dodatků","Původní cena bez DPH","Součet hodnot dodatků bez DPH","Cena po dodatcích bez DPH","Změna %","Metoda párování"])}
    </div>

    <div class="section card">
      <h2>Výpis všech smluv (interaktivní filtry)</h2>
      <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin-bottom:12px;">
        <input id="fText" placeholder="Hledat v názvu / dodavateli..." />
        <select id="fYear"><option value="">Rok: vše</option><option>2022</option><option>2023</option><option>2024</option><option>2025</option></select>
        <select id="fAdd"><option value="">Dodatky: vše</option><option value="with">Jen s dodatkem</option><option value="without">Bez dodatku</option></select>
        <select id="fSign"><option value="">Změna: vše</option><option value="plus">Jen navýšení (+)</option><option value="minus">Jen snížení (-)</option><option value="zero">Beze změny</option></select>
        <select id="fMethod"><option value="">Metoda párování: vše</option><option value="Číslo + dodavatel + podobnost názvu">Číslo + dodavatel + podobnost názvu</option><option value="Číslo + podobnost názvu">Číslo + podobnost názvu</option><option value="Pouze číslo smlouvy">Pouze číslo smlouvy</option><option value="Bez dodatků">Bez dodatků</option></select>
      </div>
      <div id="tblWrap"></div>
    </div>

    <div class="foot">
      Zdroj dat: ISRS export XLSX. Tento report je interní analytický materiál pro board.
    </div>
  </div>
  <script>
    const rows = {table_json};
    const methodMap = {{
      "no+supplier+subject":"Číslo + dodavatel + podobnost názvu",
      "no+subject":"Číslo + podobnost názvu",
      "no-only":"Pouze číslo smlouvy",
      "none":"Bez dodatků"
    }};
    const fmtMoney = (v) => Number(v).toLocaleString('cs-CZ') + ' Kč';
    const fmtPct = (v) => Number(v).toLocaleString('cs-CZ', {{minimumFractionDigits:2, maximumFractionDigits:2}}) + ' %';

    function renderTable(data) {{
      const head = `
        <table class="tbl">
          <thead><tr>
            <th>Rok</th><th>Název smlouvy</th><th>Dodavatel</th><th>Původní cena</th>
            <th>Počet dodatků</th><th>Součet dodatků</th><th>Konečná cena</th><th>Změna %</th><th>Metoda</th>
          </tr></thead><tbody>
      `;
      const body = data.map(r => `
        <tr>
          <td>${{r["Rok"] || ""}}</td>
          <td><a href="${{r["URL původní smlouvy"]}}" target="_blank">${{r["Název smlouvy"]}}</a></td>
          <td>${{r["Smluvní strana"] || ""}}</td>
          <td>${{fmtMoney(r["Původní cena bez DPH"] || 0)}}</td>
          <td>${{r["Počet dodatků"]}}</td>
          <td>${{fmtMoney(r["Součet hodnot dodatků bez DPH"] || 0)}}</td>
          <td>${{fmtMoney(r["Cena po dodatcích bez DPH"] || 0)}}</td>
          <td>${{fmtPct(r["Změna %"] || 0)}}</td>
          <td>${{methodMap[r["Metoda párování"]] || r["Metoda párování"]}}</td>
        </tr>
      `).join('');
      const foot = `</tbody></table><p class="muted">Počet záznamů: ${{data.length}}</p>`;
      document.getElementById('tblWrap').innerHTML = head + body + foot;
    }}

    function applyFilters() {{
      const t = (document.getElementById('fText').value || '').toLowerCase();
      const y = document.getElementById('fYear').value;
      const a = document.getElementById('fAdd').value;
      const s = document.getElementById('fSign').value;
      const m = document.getElementById('fMethod').value;
      const filtered = rows.filter(r => {{
        const hay = ((r["Název smlouvy"] || '') + ' ' + (r["Smluvní strana"] || '')).toLowerCase();
        if (t && !hay.includes(t)) return false;
        if (y && String(r["Rok"]) !== y) return false;
        if (a === 'with' && Number(r["Počet dodatků"]) <= 0) return false;
        if (a === 'without' && Number(r["Počet dodatků"]) > 0) return false;
        const delta = Number(r["Součet hodnot dodatků bez DPH"] || 0);
        if (s === 'plus' && !(delta > 0)) return false;
        if (s === 'minus' && !(delta < 0)) return false;
        if (s === 'zero' && !(delta === 0)) return false;
        const mm = methodMap[r["Metoda párování"]] || r["Metoda párování"];
        if (m && mm !== m) return false;
        return true;
      }});
      renderTable(filtered);
    }}

    ['fText','fYear','fAdd','fSign','fMethod'].forEach(id => {{
      document.getElementById(id).addEventListener('input', applyFilters);
      document.getElementById(id).addEventListener('change', applyFilters);
    }});
    applyFilters();
  </script>
</body>
</html>
"""
    out_path.write_text(html, encoding="utf-8")
    print(str(out_path))


if __name__ == "__main__":
    main()
