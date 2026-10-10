# Sčítání hlasů Praha

Phone web app that helps a polling-station commission (okrsková volební komise) count ballots for the
**Zastupitelstvo hlavního města Prahy**, municipal elections 9–10 Oct 2026, 65 seats. The user taps the
crosses they see on the paper ballot (or scans a photo); the app applies the legal rules and tallies
votes per party and per candidate. UI and user-facing text are **Czech**; code comments are English.

## Files

- `index.html` – the whole app: markup, CSS, JS (vanilla, no build, no dependencies) and the embedded
  candidate list. Sections are marked with `/* ---------- name ---------- */` comments.
- `sw.js`, `manifest.webmanifest`, `icons/`, `.nojekyll` – offline PWA for GitHub Pages hosting.
  **Bump `VERSION` in `sw.js` whenever `index.html` or icons change**, otherwise phones keep the old copy.
- `tests/app.test.js` – UI tests (counting rules, entry, history, results, list import, backup, PWA/offline).
- `tests/scan.test.js` – photo-recognition tests on synthetic ballot photos drawn in the page (no image
  files): single pages, rotation/light/JPEG, folds with fake boxes, several photos per ballot.
- `tests/real.test.js` + `tests/fixtures/ballot-21-24/` – real phone photos of a marked test ballot
  (page with parties 21–24, 4 angles); each photo alone and all four together must read exactly
  21: party + 4; 22: 22, 29; 23: 28; 24: party + 28, 35. `APP=<file>` runs them against another copy.
- `tools/make_icons.py` – regenerates icons (Pillow).
- `README.md` – Czech user docs (GitHub Pages setup, home screen, rules, scan feature).

## Running and testing

```
npm test           # 20 UI tests, ~15 s
npm run test:real  # 5 tests on real ballot photos, ~10 s
npm run test:all   # all three suites
npm run test:scan  # 19 photo tests; SCAN_SEED=n draws different crosses, SCAN_SAVE=dir keeps images
```
Tests use Playwright from `/opt/node-tools/node_modules/playwright` (falls back to `require('playwright')`);
Chromium is preinstalled in the cloud container – never run `playwright install`. No npm install needed.
Run both suites (and a couple of `SCAN_SEED` values after touching scan code) before pushing.

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
  the user adds up to 8 photos of ballot pages (`scanPhotos`, camera input `#scanFile` or gallery
  `#scanGallery`), then **Vyhodnotit** runs `scanDetectFile()` on each photo that has no result yet.
  - `scanDetect()` (`scan-core:start/end`, pure-JS canvas) finds columns of boxes (square party box
    above ~2:1 candidate boxes) and the ink in each box;
  - `scanFixHeads()` finds a party box the detector could not attach (party 21 has a long manifesto,
    so its box is ~25 lines above candidate 1): on the row of the other columns' party boxes, where the
    column's line of boxes meets it – a one-box stray "column" there is merged, otherwise
    `scanFindSquare()` searches the photo locally (square outline, edges must not run on = no lines);
  - `scanCosts()` scores every possible left-column party per photo by matching detected box counts to
    the known candidate counts; a DP may leave out a column that fits no party (text, a frame line,
    the shifted lower half of a folded page) – `costs.assign[s]` / `costs.used[s]`, read via `scanPlan()`
    (a party picked in the select means plain column i → party s+i, no skipping);
  - `scanAssign()` picks the parties for all photos jointly (DP): ties (65+65 pages) are resolved by
    assuming photos follow each other in ballot order, starting at party 1 or after the page applied
    last (`scanNext`); overlap with the previous photo is penalised; a user's choice is kept fixed;
  - `scanKeep()` reconciles a column with the party's candidate count, **only for near misses**
    (≤ 3 or 10 % off – bigger mismatches are the wrong party, and repairing them made the app hang).
    Spacing is only roughly even (2-line entries ~1 pitch, 3-line ~1.5, long manifestos more), so
    every repair is verified against the photo: tall boxes are split only if printed boxes are found,
    missed boxes are filled only where a printed square is found (`snapped`; unsnapped fills can be at
    most "unsure"), fake boxes (fold creases) = flat / not a printed box / alone in a gap, and a fake
    plus a missed box in one column are swapped;
  - the same party on several photos → the reading needing the fewest repairs wins (`scanQuality`),
    tie → later photo; equally good readings that differ are reported;
  - thresholds `SCAN_MARK` 0.08 / `SCAN_UNSURE` 0.035; unsure marks are never applied; **Použít na
    lístek** only fills the draft, never saves.
  Real-world data so far: one blank photo of page 1, a screenshot of the page with parties 21–24
  (fold between candidates 42/43) and 4 photos of a marked test ballot, page 21–24 (21: party + 4;
  22: 22, 29; 23: 28; 24: party + 28, 35) – all read correctly; these 4 are in `tests/fixtures/`
  (the user allowed it). New real photos with known crosses should be added there with a test.
  Detection works on grayscale + a local (adaptive) threshold, so uneven light and shadows are handled
  per region; a global black-and-white conversion would lose pale pencil crosses.

## Publishing

- **GitHub**: repo `mirpol1337/volby`, branch `claude/prague-ballot-counter` (the only branch; the PR/merge flow has not been set up).
  GitHub Pages can serve it from the repo root.
- **claude.ai artifact** (what the user opens on the phone):
  https://claude.ai/artifact/SYNnpXVAoK2cfJDH2AB442 – publish to the same URL, never create a new one.
  The artifact must not contain the document wrapper, and its sandbox blocks downloads, so build it as:
  ```
  grep -v '<!--wrap-->' index.html | grep -v 'id="dlCsv"' > <scratchpad>/scitani-praha.html
  ```
  Lines ending in `<!--wrap-->` (doctype, html/head/body tags, manifest/icon links) exist only for the
  standalone/Pages version – never put needed content on such lines. The service worker registers only
  on https/localhost and fails silently inside the artifact sandbox.

## Conventions

- Keep it a single dependency-free `index.html`; no frameworks, no CDN scripts (must work offline).
- Colors only via the CSS tokens in `:root` (light + two dark blocks); test at 390 px width, light and dark.
- Czech plurals via `pl(n, 'lístek', 'lístky', 'lístků')`; escape user/list text with `esc()`.
- No `alert/confirm/prompt` (blocked in the artifact) – destructive actions use a two-tap confirm button.
- Never put real voter data or photos of voter lists into the repo or tests (photos of test ballots
  are fine when the user agrees).
- Commit messages end with the Co-Authored-By / Claude-Session lines from the session instructions.
