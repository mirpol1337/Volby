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

1. Vyfoťte stránky lístku, na kterých jsou křížky (**Vyfotit stránku**, opakovaně), nebo je vyberte z galerie – **až 8 fotek** jednoho lístku. Každou stránku zvlášť: zpředu, celé sloupce včetně políček stran, rovně a při dobrém světle. Fotku lze křížkem v náhledu odebrat.
2. Klepněte na **Vyhodnotit**. Rozpoznávání běží jen v telefonu (bez sítě).
3. U každé fotky aplikace sama odhadne, které strany na ní jsou: zná pořadí stran na lístku a počet kandidátů každé z nich, takže posloupnost počtů políček ve sloupcích (např. 15 a 1 → strany 3–4) obvykle sedí jen na jedno místo. Stránky, kde mají všechny sloupce 65 kandidátů, vypadají stejně – tam aplikace předpokládá, že fotky jdou po sobě (další fotka navazuje na předchozí), a ostatní možnosti nabídne jedním klepnutím. Ruční volba strany u jedné fotky posune odhad u dalších.
4. Počet políček ve sloupci se srovná s počtem kandidátů strany: falešné políčko na přehybu papíru se vynechá (v náhledu šedě čárkovaně) a políčko, které rozpoznání přehlédlo, se doplní do mezery v pravidelné rozteči (v náhledu čárkovaně) – obojí aplikace vypíše, ať to zkontrolujete.
5. Náhled ukazuje rozpoznaná políčka: zeleně prázdná, purpurově s křížkem, oranžově nejistá (ta se nepřenášejí). Je-li stejná strana na dvou fotkách, platí pozdější fotka.
6. **Použít na lístek** přenese křížky na rozpracovaný lístek (jen u stran z fotek) – nic se neukládá. Lístek zkontrolujete s papírem a uložíte jako obvykle.

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

Testy rozpoznání z fotek (kreslí si vlastní syntetické fotky lístku s křížky, natočené, tmavší i zmenšené):

```sh
npm run test:scan
```

Je potřeba Node.js a balíček `playwright` s nainstalovaným Chromiem (`npm i -D playwright && npx playwright install chromium`). Testy vypíšou souhrn a při chybě skončí nenulovým kódem.

Ikony v `icons/` se generují skriptem `python3 tools/make_icons.py` (potřebuje Pillow).
