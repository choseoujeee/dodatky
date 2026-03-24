# Registr-board — React dashboard (ISRS, smlouvy o dílo, dodatky)

Klientská aplikace (bez backendu): **přetáhnete export** (XLSX/CSV) z registru smluv, zobrazí se **náhled analýzy**, upravíte název města a kliknete **„Uložit do přehledu a reportu“**. Postupně přidáváte další města stejným způsobem. Data se **ukládají v prohlížeči** (localStorage) a přežijí obnovení stránky; zálohu si můžete stáhnout jako **JSON**.

## Postup pro vedení

1. Přetáhněte export do vyznačené oblasti (nebo klikněte a vyberte soubor).
2. Zkontrolujte náhled KPI a název města.
3. **Uložit do přehledu** — město se přidá do sbírky a zapojí se do celkového reportu a grafů.
4. Opakujte pro další obce / města.
5. Volitelně: **Exportovat JSON** jako zálohu pro jiný počítač nebo před čištěním úložiště; na jiném PC **Importovat JSON**.

## Párování dodatků

- Pokud export obsahuje sloupce s textem **„návaz“** v názvu (typicky *ID návazné smlouvy*), použije se **deterministické** párování: dodatek má v těchto sloupcích ID kmenové smlouvy.
- Standardní export z portálu často tyto sloupce **nemá** (ověřeno u vzorku v repozitáři). Pak se použije **heuristika** stejně jako ve skriptu `analyze_isrs_xlsx.py` (č. j. + podobnost názvu + dodavatel). V UI je na to upozornění.
- Checkbox **„Vynutit heuristiku“** ignoruje sloupce návaznosti i tehdy, když v souboru jsou (pro srovnání metod).

## Vývoj

```powershell
cd "Work\2 Projects\Registr scrape\registr-board"
npm install
npm run dev
```

## Produkční build

```powershell
npm run build
```

Výstup ve složce `dist/` — statické soubory vhodné pro libovolný **HTTPS** hosting.

## Nasazení a Google Sites

1. Nahrajte obsah `dist/` na hosting s HTTPS (např. **GitHub Pages**, **Cloudflare Pages**, **Firebase Hosting**, firemní web).
2. V **Google Sites** přidejte komponentu pro vložení URL / iframe a vložte veřejnou adresu aplikace (např. `https://vas-ucet.github.io/registr-board/`).
3. Ověřte, že Sites iframe neblokuje danou doménu (záleží na nastavení organizace).

`vite.config.ts` má `base: "./"` — relativní cesty k assetům, vhodné i pro hostování v podadresáři.

## Omezení

- Data se zpracovávají **v prohlížeči**; citlivé exporty neposílejte na cizí servery, pokud nepoužíváte vlastní hosting.
- Velmi velké soubory mohou na slabších zařízeních zpomalit parsování (knihovna `xlsx`).

## Volitelně: GitHub Actions (Pages)

V repozitáři s povolenými GitHub Pages (zdroj: *GitHub Actions*) můžete přidat workflow, které po pushi spustí `npm ci && npm run build` a nasadí `dist/` na větev `gh-pages` nebo artifact pro Pages — konkrétní YAML závisí na organizaci úřadu.
