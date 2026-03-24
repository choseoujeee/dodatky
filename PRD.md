1. Cíl projektu a celková architektura
Cílem je nahradit stávající jednorázové statické exporty a nepřesné textové párování dynamickým Business Intelligence (BI) dashboardem. Aplikace automaticky a bezchybně vyhodnotí objem a finanční dopad dodatků (víceprací) k původním smlouvám. Řešení je navrženo na bezúdržbové a licenčně bezplatné architektuře využívající služby Google:

Zdroj dat: Otevřená data (Open Data) z Informačního systému registru smluv (ISRS).

ETL proces (Extract, Transform, Load): Python skript zajišťující stažení, zpracování a výpočty.

Datový sklad: Google Sheets (Tabulky Google), sloužící jako rychlá mezivrstva.

BI a vizualizace: Google Looker Studio.

Prezentační frontend: Google Sites (Weby Google).

2. Fáze extrakce a transformace dat (ETL proces)
Zásadní inovací celého projektu je opuštění heuristického párování dodatků podle názvu a přechod na deterministické databázové spojování pomocí státního API.

Extrakce (Získání dat): Automatizovaný skript bude pravidelně stahovat XML datové balíčky (dumpy) z oficiálního portálu otevřených dat Registru smluv (https://smlouvy.gov.cz/stranka/otevrena-data).

Filtrování: Parsovací skript projde XML uzly <zaznam>. Pomocí elementu <subjekt><ico> vyfiltruje pouze smlouvy patřící městu (např. IČO 00298077 pro město Kopřivnice) a jeho příspěvkovým organizacím. Dále odfiltruje zakázky, jejichž původní <hodnotaBezDph> je nižší než 500 000 Kč.

Deterministické párování: Skript naprosto přesně spojí smlouvu s dodatkem pomocí databázového klíče. Pokud XML uzel obsahuje element <navazanyZaznam> s číselnou hodnotou (např. 22956327), jedná se o dodatek a toto číslo přesně odpovídá tagu <idSmlouvy> u původní kmenové smlouvy.

Agregace financí: U takto spárovaných rodin smluv provede skript součet hodnot víceprací (či odečtení méněprací), vypočítá konečnou cenu a procentuální nárůst (případně pokles).

3. Fáze uložení dat (Datový sklad v Google Sheets)
Konečným výstupem ETL skriptu nebude HTML soubor, ale čistá databázová tabulka.

Automatický zápis: Python skript využije knihovnu gspread a Google Sheets API, pomocí kterých automaticky přepíše data ve vyhrazeném dokumentu Google Sheets. Skript může běžet bezobslužně (např. pomocí cronu na serveru nebo přes Google Cloud Functions).

Datový model: Tabulka bude obsahovat připravené sloupce optimalizované pro BI: ID smlouvy, Název projektu, Název a IČO dodavatele, Rok uzavření, Původní cena (bez DPH), Počet dodatků, Hodnota dodatků celkem, Konečná cena, Změna v %, Odkaz na detail.

4. Fáze vizualizace (Google Looker Studio)
V aplikaci Looker Studio se vytvoří interaktivní vrstva pro analýzu dat, ze které bude těžit vedení města.

Napojení: Jako zdroj dat (Data source) se přidá konektor na výše vytvořený Google Sheet dokument.

Aktualizace (Data Freshness): V nastavení datového zdroje se frekvence automatické aktualizace nastaví například na 1 hodinu nebo 12 hodin. Jakmile Python skript aktualizuje Google tabulku, Looker Studio si změny samo natáhne bez nutnosti manuálního refreshe.

Návrh UI dashboardu:

Ovládací panel: Rozbalovací seznamy a vyhledávací pole umožňující filtrovat podle let, jména dodavatele či textu v názvu projektu.

Scorecards (KPI karty): Velká čísla ukazující celkovou hodnotu investic, počet dodatkovaných smluv a především hlavní argumentační metriku – Váženou změnu ceny v %.

Grafy: Časové řady vývoje průměrného navýšení a sloupcové grafy ukazující podíl víceprací u různých typů projektů.

Interaktivní tabulka (Outliers): Tabulka TOP navýšení (nebo TOP úspor), kde lze sloupce dynamicky řadit. Řádky budou obsahovat přímé URL odkazy, po jejichž prokliku se uživatel dostane přímo na naskenovaný dokument v Registru smluv k ověření dat.

5. Fáze publikace a integrace (Google Sites)
Posledním krokem je elegantní vložení vytvořeného řešení přímo do webové prezentace, aby aplikace nepůsobila jako externí nástroj, ale jako přirozená součást IT ekosystému města.

Vygenerování Embed URL: V nastavení hotového reportu v Looker Studiu se aktivuje možnost "Vložit report" (Embed report) a vybere se možnost získání "Vložit URL" (Embed URL), která vygeneruje unikátní odkaz.

Vložení do webu (Iframe): V administraci Google Sites (nebo jiného redakčního systému města) se pomocí komponenty pro vkládání obsahu z webu umístí zkopírované URL. Dashboard se tak načte v responzivním iFrame okně přímo na stránce města.

Zabezpečení a přístupy: Podle nastavení oprávnění v Google Workspace lze vytvořit plně otevřenou stránku pro veřejnost a skrytou, chráněnou podstránku pro radní a auditory, kteří tak získají přístup k citlivějším analytickým dimenzím.