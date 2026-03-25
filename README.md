# Registr scrape

Samostatný projekt pro stažení dat z Registru smluv a výpočet dopadu dodatků na původní **smlouvy o dílo**.

## React dashboard (board v prohlížeči)

Složka [`registr-board/`](registr-board/) — Vite + React: nahrání exportu XLSX/CSV, KPI, srovnání měst, tabulka s odkazy do registru. U exportů bez deterministických vazeb umí apka spustit scraping „parent ID“ přes Netlify Functions. Viz [`registr-board/README.md`](registr-board/README.md).

### Deterministické provázání přes scraping

Export z portálu někdy neobsahuje sloupce s „ID návazné smlouvy“. V takovém případě apka využije URL z exportu (`Adresa záznamu`) a serverově (v Netlify background jobu) vyextrahuje z HTML:
- `ID smlouvy` (kontrola konzistence),
- `id navazne smlouvy` (parent/kmenová smlouva).

Výsledek se deterministicky agreguje do reportu a pro kontrolu je v tabulce odkaz na konkrétní záznamy v registru.

## Co to dělá

- Projde výsledky vyhledávání podle publikujícího subjektu (např. `město kopřivnice`).
- Stáhne detail každé smlouvy.
- Rozpozná původní smlouvy o dílo vs. dodatky.
- Spáruje dodatky s původní smlouvou přes `ID návazné smlouvy`; pokud export nemá tyto sloupce, apka je dovytěží serverově ze stránky registru (deterministicky).
- Spočítá:
  - původní cenu bez DPH,
  - počet dodatků,
  - součet hodnot dodatků (včetně záporných),
  - cenu po dodatcích,
  - procentní změnu.

## Instalace

V PowerShellu ve složce projektu:

```powershell
cd "Work\2 Projects\Registr scrape"
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

## Spuštění

```powershell
python .\scrape_registr_smluv.py --city "město kopřivnice" --max-pages 20
```

Volitelné parametry:

- `--city` název publikujícího subjektu
- `--max-pages` max počet stránek výsledků
- `--sleep` pauza mezi requesty (sekundy)
- `--output-dir` výstupní složka

## Výstupy

Skript vytvoří složku `output/`:

- `raw_records.csv` - surová data všech detailů
- `sod_analysis.csv` - agregace po původních SOD
- `summary.txt` - rychlé KPI (včetně průměrné změny %)

## Poznámky k interpretaci

- Dodatky bez ceny jsou zahrnuté v počtu dodatků, ale do ceny se nezapočítají.
- Záporné dodatky (méněpráce) snižují výslednou cenu.
- Pro férové srovnání mezi městy použijte stejný horizont dat a stejný filtr (jen smlouvy o dílo).
