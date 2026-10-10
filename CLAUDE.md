# Sčítání hlasů Praha

Phone web app that helps a polling-station commission (okrsková volební komise) count ballots for the
**Zastupitelstvo hlavního města Prahy**, municipal elections 9–10 Oct 2026, 65 seats. The user taps the
crosses they see on the paper ballot (or photographs it – read by `ballot.py`); the app applies the legal rules and tallies
votes per party and per candidate. UI and user-facing text are **Czech**; code comments are English.

## Files

- `index.html` – the whole app: markup, CSS, JS (vanilla, no build, no dependencies), the embedded
  candidate list and a verbatim copy of `ballot.py`. Sections are marked with `/* ---------- name ---------- */`.
- `ballot.py` – photo recognition (Python + OpenCV, by Ondra Červenka): frames of the party columns →
  each column straightened → boxes = filled shapes surviving an opening → ink in the centre of each box;
  parties from the box counts (`--first-party` otherwise). **The app runs this script unchanged** under
  Pyodide – do not rewrite it in JS (the user's decision); improve recognition in `ballot.py` itself,
  then `python3 tools/embed-ballot.py` (a test checks the embedded copy). CLI: `python ballot.py photo.jpg
  --annotate out.jpg [--first-party 21]`; needs `pip install opencv-python-headless`; it downloads
  `candidates.json` (gitignored) on first run – or write it from the embedded list (see `scanCandidates()`).
- `sw.js`, `manifest.webmanifest`, `icons/`, `.nojekyll` – offline PWA for GitHub Pages hosting (Pyodide
  from the CDN is cached after first use). **Bump `VERSION` in `sw.js` whenever `index.html` or icons
  change**, otherwise phones keep the old copy.
- `tests/app.test.js` – UI tests (counting rules, entry, history, results, list import, backup, PWA/offline).
- `tests/scan.test.js` – photo tests on synthetic ballot photos drawn in the page (no image files):
  single pages, rotation/light/JPEG, party detection by box counts, 65+65 → left-column party picked,
  NOT READ columns, several photos per ballot, no internet.
- `tests/real.test.js` + `tests/fixtures/ballot-21-24/` – real phone photos of a marked test ballot
  (page with parties 21–24, 4 angles); 21: party + 4; 22: 22, 29; 23: 28; 24: party + 28, 35. Photo 3
  reads 22–24 only (ballot.py misses the frame of party 21 there). `APP=<file>` uses another copy.
- `tests/pyodide.js` – serves Pyodide from `tests/.pyodide/` (gitignored, ~72 MB) in place of the CDN;
  get it with `sh tools/get-pyodide.sh` (downloads the 300 MB release from GitHub, keeps 7 files).
- `tools/scan-photos.js` – prints what the app reads from given photos (one batch, like the app);
  `OUT=<dir>` saves ballot.py's annotated photos, `FIRST=<n>` sets the left-column party.
- `tools/embed-ballot.py` – copies `ballot.py` into `index.html`; `tools/build-artifact.sh <dir>` builds the
  artifact page + its `pyodide/` files (see Publishing).
- `tools/make_icons.py` – regenerates icons (Pillow).
- `README.md` – Czech user docs (GitHub Pages setup, home screen, rules, scan feature).

## Running and testing

```
npm test           # 21 UI tests, ~15 s
npm run test:scan  # 15 synthetic photo tests, ~90 s (Pyodide loads per test); SCAN_SEED=n, SCAN_SAVE=dir
npm run test:real  # 5 tests on real ballot photos, ~55 s
npm run test:all   # all three suites
```
The photo suites need `tests/.pyodide` (`sh tools/get-pyodide.sh`; cdn.jsdelivr.net is blocked in the
cloud container, GitHub release downloads work – resume if the transfer is cut off).
Tests use Playwright from `/opt/node-tools/node_modules/playwright` (falls back to `require('playwright')`);
Chromium is preinstalled in the cloud container – never run `playwright install`. No npm install needed.
Run `npm run test:all` before pushing. **Always wrap test and tool runs in `timeout`** (e.g.
`timeout 600 npm run test:all`) – if a run takes much longer than above, treat it as a bug.

## Architecture of `index.html`

- **State** (localStorage, every access wrapped in try/catch): `volby-praha-cfg-v1` (`cfg`: seats,
  parties, `sample` flag, `zapis` envelope counts), `volby-praha-ballots-v1` (`ballots`),
  `volby-praha-draft-v1` (unsaved selection). Ballot record: `{id, t, parties:[n], cands:["p:c"], count,
  invalid?, reason?}`; `count > 1` = bulk entry. Results are **recomputed** from records with the current
  list (`tally()` → `evaluate()`), so fixing the candidate list fixes results.
- **Candidate keys** are `"<party ballot number>:<candidate order>"`, e.g. `"22:41"`.
- **Candidate list**: official ČSÚ registry (KV2026, state 23 Sep 2026, 24 parties / 1060 candidates)
  embedded in `<script type="text/plain" id="kandidati-2026">`, text format parsed by `parseList()`:
  `# <ballot no> <party name>` then `<order>. <name>, <info>`; `[VZDAL SE]` marks a withdrawn candidate
  (`c.w`). While `cfg.sample` is true the built-in list is reloaded on every start. The XML importer reads
  volby.cz open data `kvrk.xml` + `kvros.xml` (fields `KODZASTUP` 554782, `POR_STR_HL` = ballot number,
  `PORCISLO`, `PLATNOST` N = withdrawn).
- **Counting rules** live in `evaluate()` – keep them there and covered by tests (zákon 491/2001 Sb.
  § 34, 40, 41; zákon 88/2024 Sb. § 64 for invalid ballots):
  - one party only → its candidates in ballot order up to 65 (withdrawn ones skipped);
  - candidates only → each marked one, max 65 else invalid;
  - party + other parties' candidates → those candidates + first (65 − their count) of the party;
  - crosses at the marked party's own candidates are ignored;
  - withdrawn candidates get no vote but their crosses count toward the 65 limit;
  - invalid: nothing marked, >1 party, >65 candidates; manual reasons (non-official ballot, outside
    official envelope, several ballots in one envelope = one invalid, torn).
  - **Unconfirmed edge cases** (see git log / ask the user before changing): party + all its own
    candidates + another party's candidate is treated as valid; a cross at another party's withdrawn
    candidate uses up one of the 65 places in a party+candidates ballot.
- **Vyfotit lístek** (photo recognition, between `Rozpoznání lístku z fotek` and its `end of` marker):
  the user adds up to 8 photos (`scanPhotos`, camera `#scanFile` or gallery `#scanGallery`); **Vyhodnotit**
  loads Pyodide 0.26.4 + numpy + opencv-python (~65 MB, once per page load; needs internet – the user
  chose ballot.py only, no offline JS fallback) and runs the embedded `ballot.py`:
  - `scanPython()` tries `pyodide/` next to the page (the artifact), then cdn.jsdelivr.net/pyodide (Pages,
    tests); `scanParts()` serves files published in parts (`pyodide/parts.json`, the OpenCV wheel);
  - `candidates.json` is written from `cfg.parties` before every run (`scanCandidates()`);
  - `scanRead()`: photo → JPEG ≤ 2600 px (`scanJpeg`, applies EXIF rotation, decodes HEIC) →
    `ballot.read_ballot(photo, load_parties(), first_party, annotated.jpg)`; `SystemExit` messages are
    translated by `scanError()` (65+65 page → pick the party in the left column = `--first-party`);
  - a column is applied only when its box count equals the party's candidate count (ballot.py's
    readable rule), otherwise NEPŘEČTENO; the same party on several photos → the later photo;
  - **Použít na lístek** only fills the draft, never saves.

## Real ballot and photos – what is known

- The printed ballot is a large folded sheet; each party is one full-height column (party box at the
  top, then one box per candidate); 65-candidate lists fold between candidates 42 and 43. Party boxes
  of all columns on a page share one row. Pages photographed so far: parties 1–2 (blank) and 21–24.
- Real data: one blank photo of page 1 (not in the repo – shows the voter list), a screenshot of the
  app's overlay for page 21–24, and 4 photos of a marked test ballot, page 21–24 (21: party + 4;
  22: 22, 29; 23: 28; 24: party + 28, 35), in `tests/fixtures/ballot-21-24/` – ballot.py reads them
  correctly except party 21 on photo 3 (frame not found, column silently missing).
- Photos the user uploads to the chat arrive downscaled (~1932×2576); the app downscales to 2600 px. A screenshot of the app's preview is not usable as input (labels cover the boxes).
- Lessons from real photos: crossed boxes can look square (party-box-like) and tall; spacing varies
  with the description length; creases make flat fake boxes and can shift half a page sideways;
  text and frame lines can form fake columns; a stamp sits next to party 21.

**Workflow for new photos from the user** (with the crosses they report as the truth):
1. Save them to `tests/fixtures/<page-or-case>/` (ask first if anything personal is visible, e.g.
   the voter list) and run `timeout 300 node tools/scan-photos.js <photos>` with `OUT=` to see
   ballot.py's annotated photos (or `python3 ballot.py <photo> --annotate out.jpg`).
2. Fix the recognition in `ballot.py` (then `tools/embed-ballot.py`); check each photo alone and together.
3. Add the expected crosses to `tests/real.test.js`; confirm the test fails on the old version
   (`APP=<old index.html>`) and passes now; run all suites; push and republish the artifact.

## Open issues

- Real hand-drawn crosses: only one marked test ballot (one page) so far; other pages and pens untested.
- ballot.py: a column whose frame is not found is silently missing (party 21 on photo 3); a fold
  crease splits frames → wrong parties, all columns NEPŘEČTENO (nothing applied); pages of 65-candidate
  lists only (9–10, 14–15 …) need the left-column party picked by the user.
- Not available in the claude.ai artifact (see Publishing) – the phone must use the GitHub Pages version.
- First use downloads ~65 MB (Pyodide + OpenCV) and takes a while on a phone; each photo ~4 s on a desktop.
- The two unconfirmed legal edge cases under *Counting rules*.

## Publishing

- **GitHub**: repo `mirpol1337/volby`, branch `claude/prague-ballot-counter` (the only branch; no PR
  flow). Commit and push there. GitHub Pages can serve it from the repo root.
- **claude.ai artifact** (what the user opens on the phone):
  https://claude.ai/artifact/SYNnpXVAoK2cfJDH2AB442 – publish to the same URL, never create a new one.
  **ballot.py cannot run in the artifact**: its sandbox lets the page fetch only files published with it,
  and the artifact refuses archives (.zip, .whl – Pyodide's stdlib, numpy, OpenCV) under any type; the
  CDN is blocked for fetches. Don't disguise the archives as other types. The artifact therefore still
  holds the last build with the built-in JS recognizer (version 9, commit 358e1ba^ = bc951ce) – do not
  republish it with the Pyodide version until the user decides; the ballot.py version is for GitHub Pages
  (or any normal https hosting). `tools/build-artifact.sh` (page + `pyodide/` files, OpenCV in parts)
  is for self-hosting Pyodide next to the page. To build a plain artifact page:
  `grep -v '<!--wrap-->' index.html | grep -v 'id="dlCsv"' > <scratchpad>/scitani-praha.html`.
  Lines ending in `<!--wrap-->` (doctype, html/head/body tags, manifest/icon links) exist only for the
  standalone/Pages version – never put needed content on such lines. The service worker registers only
  on https/localhost and fails silently inside the artifact sandbox. Republish after every change to
  `index.html` the user should see (and bump `VERSION` in `sw.js` for the Pages version).

## Conventions

- Keep it a single dependency-free `index.html`; no frameworks, no CDN scripts – the one exception is
  Pyodide for photo recognition (everything else must work offline).
- Colors only via the CSS tokens in `:root` (light + two dark blocks); test at 390 px width, light and dark.
- Czech plurals via `pl(n, 'lístek', 'lístky', 'lístků')`; escape user/list text with `esc()`.
- No `alert/confirm/prompt` (blocked in the artifact) – destructive actions use a two-tap confirm button.
- Never put real voter data or photos of voter lists into the repo or tests (photos of test ballots
  are fine when the user agrees).
- Commit messages end with the Co-Authored-By / Claude-Session lines from the session instructions.
