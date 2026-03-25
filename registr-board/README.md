# Registr-board — React dashboard (ISRS, smlouvy o dílo, dodatky)

Klientská aplikace: **přetáhnete export** (XLSX/CSV) z registru smluv, zobrazí se **náhled analýzy**, upravíte název města a kliknete **„Uložit do přehledu a reportu“**. Postupně přidáváte další města stejným způsobem. Data se **ukládají v prohlížeči** (localStorage) a přežijí obnovení stránky; zálohu si můžete stáhnout jako **JSON**.

Pro exporty bez deterministických vazeb je k dispozici volitelný **scraping parent ID** přes Netlify Functions (serverově), který spojí dodatky ke kmenovým smlouvám deterministicky podle „ID navazne smlouvy“ na stránce registru.

## Postup pro vedení

1. Přetáhněte export do vyznačené oblasti (nebo klikněte a vyberte soubor).
2. Zkontrolujte náhled KPI a název města.
3. **Uložit do přehledu** — město se přidá do sbírky a zapojí se do celkového reportu a grafů.
4. Opakujte pro další obce / města.
5. Volitelně: **Exportovat JSON** jako zálohu pro jiný počítač nebo před čištěním úložiště; na jiném PC **Importovat JSON**.

## Párování dodatků
- Pokud export obsahuje sloupce s textem **„návaz“** v názvu (typicky *ID návazné smlouvy*), použije se **deterministické** párování: dodatek má v těchto sloupcích ID kmenové smlouvy.
- Pokud export tyto sloupce **nemá**, použije se fallback **heuristika** (č. j. + podobnost názvu + dodavatel). V UI je na to upozornění.
- Pro deterministic „true vazbu“ je v UI u sady bez sloupců „návaz“ tlačítko **„Scrape vazby“**. Po dokončení se dodatky přepočítají do režimu **`Scraping parent ID (deterministické)`**. Metoda je označená v tabulce sloupcem „Metoda“.

## Scraping parent ID (deterministické)

Kdykoli export z registru smluv **nemá** sloupce s „ID návazné smlouvy“, apka může dodatečně ověřit vazby přes veřejné stránky registru:

1. Z exportu se vezmou URL záznamů z **„Adresa záznamu“** (používáme přímo URL pro každý řádek).
2. Netlify spustí background job, který pro každou dodatkovou smlouvu vyextrahuje z HTML:
   - `ID smlouvy` (kontrola konzistence),
   - `id navazne smlouvy` (parent/kmenová smlouva).
3. Výsledek se uloží do serverového cache (Netlify Blobs) a apka ho načte přes polling endpointu.
4. Pak se deterministicky agreguje: **původní SOD + součet hodnot dodatků**, včetně méněprací (záporné hodnoty).

Poznámky:
- Job je limitovaný Netlify execution time, prakticky se ale vejde do ~10 minut pro exporty velikosti okolo 2000 řádků (podle chování serveru a dostupnosti).
- Pokud scraping selže u části URL (výpadek, dočasné blokování), v tabulce a v progressu se objeví počet chyb; stačí opakovat.
- Mapping není ukládán do `localStorage` jako velký JSON; po refreshu stránky se přepočítá podle toho, co je k dispozici (pro 100% jistotu znovu klikni „Scrape vazby“).

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
