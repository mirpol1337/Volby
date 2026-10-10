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
- `tests/scan.test.js` – photo-scan tests on synthetic ballot photos drawn in the page (no image files).
- `tools/make_icons.py` – regenerates icons (Pillow).
- `README.md` – Czech user docs (GitHub Pages setup, home screen, rules, scan feature).

## Running and testing

```
npm test           # 20 UI tests, ~15 s
npm run test:scan  # 15 scan tests; SCAN_SEED=n draws different crosses, SCAN_SAVE=dir keeps images
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
- **Skenovat foto** (experimental, between `EXPERIMENTAL: Skenovat foto` and `end of Skenovat foto`):
  pure-JS canvas detector `scanDetect()` (`scan-core:start/end`) finds columns of boxes (square party box
  above ~2:1 candidate boxes) and ink per box. Then:
  - `scanGuess()` picks which parties are on the photo by matching detected box counts per column to
    the known candidate counts (65+65 pages are ambiguous → prefers the page after the previously
    applied one, `scanNext`, and offers alternatives as chips);
  - `scanKeep()` reconciles each column with the party's candidate count: drops fake boxes at paper
    folds (alone in a wide gap, flat), interpolates boxes the detector missed (gap of 2–3 pitches),
    swaps the two when both occur;
  - thresholds `SCAN_MARK` 0.08 / `SCAN_UNSURE` 0.035; unsure marks are never applied; "Použít" only
    fills the draft, never saves a ballot.
  Real-world data so far: one blank photo of page 1 and one marked screenshot of the page with parties
  21–24 (fold between candidates 42/43). Real hand-drawn crosses are largely untested.

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
- Never put real voter data or photos of voter lists into the repo or tests.
- Commit messages end with the Co-Authored-By / Claude-Session lines from the session instructions.
