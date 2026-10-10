# Sčítání hlasů Praha

Jednoduchá webová aplikace do telefonu pro okrskové volební komise: pomáhá sčítat hlasovací lístky do **Zastupitelstva hl. m. Prahy** (65 členů).

- Lístek se zadává klepáním na křížky (strana / kandidáti) nebo kódem: `3` = strana 3, `3.12` = kandidát 12 strany 3, `3.1-10` = kandidáti 1–10, případně hledáním podle příjmení.
- Aplikace hned ukáže, zda je lístek platný a kolik hlasů komu dá.
- Hromádky lístků jen s křížkem u strany a neplatné lístky lze zadat najednou.
- Historie zadaných lístků s opravou a mazáním, výsledky po stranách i kandidátech, export CSV.
- Kandidátní listiny se vkládají jako text (nebo z otevřených dat volby.cz).
- Data zůstávají jen v telefonu (localStorage). Mezi telefony se přenášejí zálohou (JSON) – při sloučení se stejný lístek nezapočte dvakrát.
- Po prvním načtení funguje **i bez signálu** (service worker), lze ji přidat na plochu jako aplikaci.

Aplikace je jen pomůcka – závazný je zápis okrskové volební komise.

## Vyfotit lístek (rozpoznání křížků z fotek)

Tlačítko **Vyfotit lístek** nad lístkem předvyplní křížky z fotek stránek papírového lístku.

Fotky čte skript **`ballot.py`** (Python s OpenCV) – aplikace ho spouští beze změny přímo v telefonu pomocí Pyodide. Při prvním vyhodnocení se stáhne asi **65 MB** (Python, NumPy, OpenCV), proto je potřeba **internet**; na GitHub Pages se stažené soubory uloží a příště už fungují i offline.

1. Vyfoťte stránky lístku, na kterých jsou křížky (**Vyfotit stránku**, opakovaně), nebo je vyberte z galerie – **až 8 fotek** jednoho lístku. Každou stránku zvlášť: zpředu, celé sloupce včetně rámečků a políček stran, rovně a při dobrém světle. Fotku lze křížkem v náhledu odebrat.
2. Klepněte na **Vyhodnotit**. `ballot.py` najde rámečky sloupců, každý sloupec narovná, najde políčka a v nich křížky.
3. Strany na fotce se poznají podle počtu políček ve sloupcích (např. 15 a 1 → strany 3–4). Stránky, kde mají všechny sloupce 65 kandidátů, vypadají stejně – tam vyberte **stranu v levém sloupci fotky** (výběr lze použít i pro opravu odhadu).
4. Sloupec, ve kterém je jiný počet políček, než má strana kandidátů, je **NEPŘEČTENO** – křížky v něm zkontrolujte a zadejte ručně, na lístek se nepřenesou.
5. Náhled ukazuje rozpoznaná políčka: červeně s křížkem, zeleně prázdná. Je-li stejná strana na více fotkách, platí pozdější fotka.
6. **Použít na lístek** přenese křížky na rozpracovaný lístek (jen u přečtených stran) – nic se neukládá. Lístek zkontrolujete s papírem a uložíte jako obvykle.

`ballot.py` lze spustit i samostatně: `python ballot.py fotka.jpg --annotate náhled.jpg [--first-party 21]` (potřebuje `opencv-python`). Po každé změně skriptu ho do aplikace zkopírujte: `python3 tools/embed-ballot.py`.

## Zveřejnění na GitHub Pages

1. Na GitHubu otevřete repozitář → **Settings** → **Pages**.
2. V části *Build and deployment* zvolte **Source: Deploy from a branch**.
3. Vyberte větev (např. `main`) a složku **`/ (root)`**, uložte.
4. Za chvíli bude aplikace na adrese `https://<uživatel>.github.io/<repozitář>/`.

Offline režim (service worker) funguje jen přes `https://` (nebo `localhost`). Po změně `index.html` nebo ikon zvyšte v `sw.js` hodnotu `VERSION`, aby si telefony stáhly novou verzi (projeví se při dalším otevření aplikace).

## Přidání na plochu telefonu

Otevřete adresu aplikace **ještě s internetem** (načte se a uloží pro offline použití), pak:

- **Android (Chrome):** menu ⋮ → **Přidat na plochu** / **Instalovat aplikaci**.
- **iPhone (Safari):** tlačítko **Sdílet** → **Přidat na plochu**.

Aplikace se pak otevírá z ikony přes celou obrazovku a funguje i bez signálu. Před sčítáním si ji raději jednou otevřete a zkontrolujte kandidátní listiny.

## Pravidla sčítání

Podle zákona č. 491/2001 Sb., o volbách do zastupitelstev obcí (počet volených členů lze změnit na kartě Kandidáti):

- **Křížek u jedné strany:** hlas dostanou kandidáti této strany podle pořadí na lístku, nejvýše tolik, kolik se volí členů (65). Má-li strana méně kandidátů, dostane hlas každý z nich.
- **Křížky u jednotlivých kandidátů** z libovolných stran: hlas dostane každý označený, nejvýše 65.
- **Strana + kandidáti jiných stran:** hlas dostanou označení kandidáti a z označené strany tolik prvních kandidátů, kolik zbývá do 65 (je-li označených kandidátů 65, strana nedostane nic a lístek je platný).
- Křížky u kandidátů **téže strany**, která je zároveň označena, se nepočítají – platí křížek u strany.
- Lístek je **neplatný**, když není označeno nic, je označeno více stran, nebo více kandidátů, než je volených členů. Neplatný je i lístek neúřední, mimo úřední obálku, přetržený nebo je-li v obálce více lístků do téhož zastupitelstva – ty se zadávají tlačítkem **Neplatný…**.

## Testy

Automatické testy procházejí aplikaci přes uživatelské rozhraní v prohlížeči Chromium (Playwright):

```sh
npm test
# nebo jen část testů podle názvu:
node tests/app.test.js záloha
```

Testy rozpoznání z fotek (syntetické fotky lístku i skutečné fotky v `tests/fixtures/ballot-21-24/`) spouštějí `ballot.py` v Pyodide; ten se stáhne jednou do `tests/.pyodide`:

```sh
sh tools/get-pyodide.sh
npm run test:scan
npm run test:real
npm run test:all   # všechny testy
```

Je potřeba Node.js a balíček `playwright` s nainstalovaným Chromiem (`npm i -D playwright && npx playwright install chromium`). Testy vypíšou souhrn a při chybě skončí nenulovým kódem.

Ikony v `icons/` se generují skriptem `python3 tools/make_icons.py` (potřebuje Pillow).
