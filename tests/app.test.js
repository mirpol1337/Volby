#!/usr/bin/env node
/* UI tests for index.html, driven through Playwright + Chromium.
   Run: npm test   (or: node tests/app.test.js)
   Each test gets a fresh browser context, i.e. empty localStorage. */
'use strict';
const path = require('path');
const fs = require('fs');
const assert = require('assert/strict');

let playwright;
try { playwright = require('/opt/node-tools/node_modules/playwright'); } catch { playwright = require('playwright'); }

const ROOT = path.resolve(__dirname, '..');
const URL = 'file://' + path.join(ROOT, 'index.html');

const LIST = `# 1 Strana A
1. Anna Alfa
2. Adam Beta
3. Aleš Gama
4. Alena Delta
5. Arnošt Epsilon
# 2 Strana B
1. Bára Jedna
2. Bohdan Dva
3. Blanka Tři
# 3 Strana C
1. Cyril Jedna
2. Cecílie Dva`;

/* ---------- helpers (all through the UI) ---------- */
const num = s => +String(s).replace(/[^\d-]/g, '');
async function hideToast(page) { await page.evaluate(() => { document.getElementById('toast').hidden = true; }); }
async function tap(page, sel) { await hideToast(page); await page.click(sel); }
async function tab(page, name) { await tap(page, `nav.tabs button[data-tab="${name}"]`); }
async function code(page, text) { await page.fill('#code', text); await page.press('#code', 'Enter'); }
async function save(page) { await tap(page, '#saveBtn'); }
async function statusText(page) { return (await page.textContent('#status')).trim(); }

async function setup(page, { list = LIST, seats = 3 } = {}) {
  await tab(page, 'settings');
  await page.fill('#listText', list);
  await tap(page, '#applyList');
  assert.match(await page.textContent('#listMsg'), /Načteno/);
  if (seats != null) {
    await page.fill('#seats', String(seats));
    await page.press('#seats', 'Tab');
    assert.equal(await page.inputValue('#seats'), String(seats));
  }
  await tab(page, 'ballot');
}

async function results(page) {
  await tab(page, 'results');
  const tiles = await page.$$eval('#tiles .tile', els => els.map(e => [e.querySelector('.k').textContent, e.querySelector('.v').textContent]));
  const t = Object.fromEntries(tiles.map(([k, v]) => [k, +v.replace(/[^\d]/g, '')]));
  // expand every party that is still collapsed (the expanded state is kept between visits)
  const parties = await page.$$eval('#resTable tr.prow', rows => rows.filter(r => r.querySelector('.hint').textContent === '▼').map(r => r.dataset.p));
  for (const p of parties) await tap(page, `#resTable tr.prow[data-p="${p}"]`);
  const party = Object.fromEntries(await page.$$eval('#resTable tr.prow', rows => rows.map(r => [r.dataset.p, r.children[2].textContent])));
  const cand = Object.fromEntries(await page.$$eval('#resTable tr.crow-r', rows => rows.map(r => [r.children[0].textContent.trim(), r.children[2].textContent])));
  const reasons = await page.textContent('#invReasons');
  const out = {
    total: t['Zpracované lístky'], valid: t['Lístky s platným hlasem'], invalid: t['Neplatné hlasy'], votes: t['Platné hlasy celkem'],
    party: Object.fromEntries(Object.entries(party).map(([k, v]) => [k, num(v)])),
    cand: Object.fromEntries(Object.entries(cand).map(([k, v]) => [k, num(v)])),
    reasons
  };
  await tab(page, 'ballot');
  return out;
}
function expectCands(r, expected) {
  for (const [k, v] of Object.entries(expected)) assert.equal(r.cand[k], v, `kandidát ${k}: čekáno ${v}, je ${r.cand[k]}`);
}

/* ---------- tests ---------- */
const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('lístek jen s křížkem u strany (klepnutím)', async page => {
  await setup(page);
  await tap(page, '.box[data-act="party"][data-p="1"]');
  assert.match(await statusText(page), /Platný/);
  assert.match(await statusText(page), /3 hlasy/);
  await save(page);
  assert.match(await statusText(page), /Prázdný/);
  const r = await results(page);
  assert.deepEqual([r.total, r.valid, r.invalid, r.votes], [1, 1, 0, 3]);
  assert.equal(r.party['1'], 3);
  expectCands(r, { '1.1': 1, '1.2': 1, '1.3': 1, '1.4': 0, '1.5': 0, '2.1': 0 });
});

test('jen kandidáti z různých stran (klepnutím)', async page => {
  await setup(page);
  await tap(page, '.pname[data-p="2"]');
  await tap(page, '.crow[data-k="2:1"]');
  await tap(page, '.pname[data-p="3"]');
  await tap(page, '.crow[data-k="3:2"]');
  assert.equal(await page.getAttribute('.crow[data-k="2:1"]', 'aria-pressed'), 'true');
  assert.match(await statusText(page), /Jednotlivě 2 kandidáti/);
  await save(page);
  const r = await results(page);
  assert.deepEqual([r.total, r.valid, r.votes], [1, 1, 2]);
  expectCands(r, { '2.1': 1, '3.2': 1, '1.1': 0, '2.2': 0 });
});

test('strana + kandidáti jiných stran: zbytek míst z pořadí strany', async page => {
  await setup(page);
  await code(page, '1 2.1');
  assert.match(await statusText(page), /Strana 1 Strana A \+ 1 kand\. jiných stran → 3 hlasy/);
  await save(page);
  const r = await results(page);
  assert.equal(r.votes, 3);
  expectCands(r, { '2.1': 1, '1.1': 1, '1.2': 1, '1.3': 0 });
  assert.deepEqual([r.party['1'], r.party['2']], [2, 1]);
});

test('strana + kandidáti téže strany: křížky u kandidátů se nepočítají', async page => {
  await setup(page);
  await code(page, '1 1.5 1.4');
  assert.match(await statusText(page), /2× křížek u kandidáta označené strany se nepočítá/);
  assert.equal(await page.$$eval('.crow.ignored', els => els.length), 2);
  await save(page);
  const r = await results(page);
  assert.equal(r.votes, 3);
  expectCands(r, { '1.1': 1, '1.2': 1, '1.3': 1, '1.4': 0, '1.5': 0 });
});

test('dvě strany → neplatný', async page => {
  await setup(page);
  await code(page, '1 2');
  assert.match(await statusText(page), /Neplatný/);
  assert.equal((await page.textContent('#saveBtn')).trim(), 'Uložit jako neplatný');
  await save(page);
  const r = await results(page);
  assert.deepEqual([r.total, r.valid, r.invalid, r.votes], [1, 0, 1, 0]);
  assert.match(r.reasons, /Označeno více stran/);
});

test('více kandidátů než volených členů → neplatný', async page => {
  await setup(page); // 3 seats
  await code(page, '1.1 1.2 2.1 3.1');
  assert.match(await statusText(page), /Neplatný.*Označeno 4 kandidátů – víc než 3/);
  await tap(page, '#clearSel');
  await code(page, '1.1-3');
  assert.match(await statusText(page), /Platný/);
  await code(page, '2.3');
  assert.match(await statusText(page), /Neplatný/);
  await save(page);
  const r = await results(page);
  assert.deepEqual([r.valid, r.invalid, r.votes], [0, 1, 0]);
  assert.match(r.reasons, /více kandidátů, než je volených členů/);
});

test('strana s méně kandidáty, než je míst', async page => {
  await setup(page, { seats: 65 });
  await code(page, '3');
  assert.match(await statusText(page), /2 hlasy/);
  await save(page);
  await code(page, '1');
  await save(page);
  const r = await results(page);
  assert.deepEqual([r.total, r.valid, r.votes], [2, 2, 7]);
  expectCands(r, { '3.1': 1, '3.2': 1, '1.5': 1 });
});

test('strana + kandidáti jiných stran == počet míst → strana nic, platný', async page => {
  await setup(page);
  await code(page, '1 2.1 2.2 3.1');
  assert.match(await statusText(page), /Platný/);
  await save(page);
  await code(page, '1 2.1 2.2 3.1 3.2');
  assert.match(await statusText(page), /Neplatný.*4 kandidátů jiných stran – víc než 3/);
  await save(page);
  const r = await results(page);
  assert.deepEqual([r.total, r.valid, r.invalid, r.votes], [2, 1, 1, 3]);
  assert.equal(r.party['1'], 0);
  expectCands(r, { '2.1': 1, '2.2': 1, '3.1': 1, '1.1': 0 });
});

const LIST_W = `# 1 Strana A
1. Anna Alfa
2. Adam Beta, 40 let, [VZDAL SE]
3. Aleš Gama
4. Alena Delta
# 2 Strana B
1. Bára Jedna [VZDAL SE]
2. Bohdan Dva
# 3 Strana C
1. Cyril Jedna`;
test('kandidát, který se vzdal: hlas nedostane, strana přeskočí, do limitu se počítá', async page => {
  await setup(page, { list: LIST_W, seats: 3 });
  // party only: withdrawn 1.2 is skipped, 1.4 moves up
  await code(page, '1'); await save(page);
  // candidates only incl. withdrawn 2.1: crosses count but 2.1 gets nothing
  await code(page, '2.1 2.2'); assert.match(await statusText(page), /vzdal/); await save(page);
  // limit: 4 crosses (one withdrawn) with 3 seats → invalid
  await code(page, '2.1 2.2 3.1 1.1'); assert.match(await statusText(page), /Neplatný/); await save(page);
  // party 1 + withdrawn 2.1: the cross takes a place, party gets 2 (1.1, 1.3)
  await code(page, '1 2.1'); await save(page);
  const r = await results(page);
  assert.deepEqual([r.total, r.valid, r.invalid], [4, 3, 1]);
  expectCands(r, { '1.1': 2, '1.2': 0, '1.3': 2, '1.4': 1, '2.1': 0, '2.2': 1 });
  assert.equal(r.votes, 6);
  // the marker survives a round trip through the list editor
  await tab(page, 'settings');
  assert.match(await page.inputValue('#listText'), /2\. Adam Beta, 40 let, \[VZDAL SE\]\n/);
  assert.match(await page.inputValue('#listText'), /1\. Bára Jedna, \[VZDAL SE\]/);
});
test('kontrola počtu obálek se zápisem', async page => {
  await setup(page);
  await code(page, '1'); await save(page);
  await code(page, '2'); await save(page);
  await tab(page, 'results');
  await page.fill('#envIssued', '10'); await page.press('#envIssued', 'Tab');
  await page.fill('#envReturned', '1'); await page.press('#envReturned', 'Tab');
  assert.match(await page.textContent('#envMsg'), /Zadáno 2 lístky, ale odevzdaných obálek je jen 1/);
  await page.fill('#envReturned', '5'); await page.press('#envReturned', 'Tab');
  assert.match(await page.textContent('#envMsg'), /bez lístku do zastupitelstva Prahy: 3/);
  await page.reload();
  await tab(page, 'results');
  assert.equal(await page.inputValue('#envReturned'), '5');
});
test('hromadné zadání ×N (strana i neplatné)', async page => {
  await setup(page);
  await tap(page, '#batchPanel > summary');
  await page.selectOption('#batchParty', '2');
  await page.fill('#batchCount', '7');
  await tap(page, '#batchAdd');
  assert.equal(await page.inputValue('#batchCount'), '1');
  await page.fill('#batchInvCount', '4');
  await tap(page, '#batchInvAdd');
  await page.fill('#batchCount', '0');
  await tap(page, '#batchAdd');
  assert.match(await page.textContent('#toast'), /aspoň 1/);
  assert.match(await page.textContent('#hdrInfo'), /11 lístků/);
  const r = await results(page);
  assert.deepEqual([r.total, r.valid, r.invalid, r.votes], [11, 7, 4, 21]);
  expectCands(r, { '2.1': 7, '2.2': 7, '2.3': 7 });
  assert.match(r.reasons, /Neplatný \(hromadně\)\s*4/);
  await tab(page, 'history');
  assert.match(await page.textContent('#hist'), /č\. 1–7 \(7 lístků\)/);
  assert.match(await page.textContent('#hist'), /č\. 8–11 \(4 lístků\)/);
});

test('ručně neplatný lístek s důvodem', async page => {
  await setup(page);
  await code(page, '1');
  await tap(page, '#invalidBtn');
  assert.equal(await page.isVisible('#reasons'), true);
  await tap(page, '#reasons [data-reason=""]'); // Zrušit
  assert.equal(await page.isVisible('#reasons'), false);
  assert.match(await page.textContent('#hdrInfo'), /^0 lístků/);
  await tap(page, '#invalidBtn');
  await tap(page, '#reasons [data-reason="Přetržený lístek"]');
  assert.match(await statusText(page), /Prázdný/); // selection was cleared
  await tap(page, '#invalidBtn');
  await tap(page, '#reasons [data-reason="Více lístků v obálce"]');
  const r = await results(page);
  assert.deepEqual([r.total, r.valid, r.invalid, r.votes], [2, 0, 2, 0]);
  assert.match(r.reasons, /Přetržený lístek\s*1/);
  assert.match(r.reasons, /Více lístků v obálce\s*1/);
});

test('toast Zpět vrátí uložení', async page => {
  await setup(page);
  await code(page, '2');
  await save(page);
  assert.match(await page.textContent('#hdrInfo'), /^1 lístek/);
  assert.match(await page.textContent('#toast'), /Lístek č\. 1 uložen – platný, 3 hlasy/);
  await page.click('#toast button');
  assert.match(await page.textContent('#hdrInfo'), /^0 lístků/);
  assert.equal(await page.isVisible('#toast'), false);
  const r = await results(page);
  assert.equal(r.total, 0);
});

test('historie: oprava a smazání lístku', async page => {
  await setup(page);
  await code(page, '1');
  await save(page);
  await code(page, '2.1');
  await save(page);
  await tab(page, 'history');
  assert.equal(await page.$$eval('#hist .hitem', e => e.length), 2);
  // newest first: "2.1" ballot
  await tap(page, '#hist .hitem:first-child [data-act="edit"]');
  assert.equal(await page.isVisible('#v-ballot'), true);
  assert.match(await statusText(page), /Lístek č\. 2: Jednotlivě 1 kandidát/);
  assert.equal(await page.getAttribute('.crow[data-k="2:1"]', 'aria-pressed'), 'true');
  await code(page, '3.1');
  await save(page);
  let r = await results(page);
  assert.deepEqual([r.total, r.votes], [2, 5]);
  expectCands(r, { '2.1': 1, '3.1': 1, '1.1': 1 });
  await tab(page, 'history');
  const del = '#hist .hitem:first-child [data-act="del"]';
  await tap(page, del);
  assert.equal((await page.textContent(del)).trim(), 'Opravdu smazat?');
  await tap(page, del);
  assert.equal(await page.$$eval('#hist .hitem', e => e.length), 1);
  r = await results(page);
  assert.deepEqual([r.total, r.votes], [1, 3]);
  expectCands(r, { '2.1': 0, '3.1': 0, '1.1': 1 });
});

test('načtení kandidátní listiny z textu (tabulátory, pokračovací řádky)', async page => {
  const list = [
    '# 7. Strana Sedm – dlouhý název',
    'pokračování názvu',
    '1. Ing. Jana Nová, 40 let, inženýrka, Praha 4',
    'bez politické příslušnosti',
    '2\tPetr Starý\t55 let\tlékař',
    '#8 Osmička',
    '2) Druhý Osm',
    '1: První Osm'
  ].join('\n');
  await setup(page, { list, seats: null });
  assert.match(await page.textContent('#listMsg'), /Načteno 2 stran a 4 kandidátů/);
  await tab(page, 'ballot');
  const names = await page.$$eval('.party .pname b', els => els.map(e => e.textContent));
  assert.deepEqual(names, ['7. Strana Sedm', '8. Osmička']);
  await tap(page, '.pname[data-p="7"]');
  await tap(page, '.pname[data-p="8"]');
  const rows = await page.$$eval('.crow', els => els.map(e => [e.dataset.k, e.querySelector('.cname').textContent, e.querySelector('.cinfo')?.textContent || '']));
  assert.deepEqual(rows, [
    ['7:1', 'Ing. Jana Nová', '40 let, inženýrka, Praha 4, bez politické příslušnosti'],
    ['7:2', 'Petr Starý', '55 let, lékař'],
    ['8:1', 'První Osm', ''],
    ['8:2', 'Druhý Osm', '']
  ]);
  // the full party name keeps the continuation line
  await tab(page, 'settings');
  assert.match(await page.inputValue('#listText'), /^# 7 Strana Sedm – dlouhý název pokračování názvu$/m);
  // errors are reported and nothing changes
  await page.fill('#listText', '1. Kandidát bez strany\n# 1 A\n1. X\n1. Y');
  await tap(page, '#applyList');
  assert.match(await page.getAttribute('#listMsg', 'class'), /bad/);
  assert.match(await page.textContent('#listMsg'), /kandidát před první stranou/);
  assert.match(await page.textContent('#listMsg'), /kandidát č\. 1 je dvakrát/);
  await tab(page, 'ballot');
  assert.equal(await page.$$eval('.party', e => e.length), 2);
});

test('záloha: kopírování a sloučení bez dvojího započtení', async (page, ctx, browser) => {
  await setup(page);
  await code(page, '1');
  await save(page);
  await code(page, '2.1 3.1');
  await save(page);
  await tap(page, '#batchPanel > summary');
  await page.selectOption('#batchParty', '3');
  await page.fill('#batchCount', '3');
  await tap(page, '#batchAdd');
  await tab(page, 'settings');
  await tap(page, '#copyBackup');
  // clipboard may be unavailable – the app then puts the backup into the textarea
  await page.waitForFunction(() => document.getElementById('backupText').value || /Záloha zkopírována/.test(document.getElementById('toast').textContent));
  let backup = await page.inputValue('#backupText');
  if (!backup) backup = await page.evaluate(() => navigator.clipboard.readText());
  const parsed = JSON.parse(backup);
  assert.equal(parsed.app, 'scitani-praha');
  assert.equal(parsed.ballots.length, 3);

  // second phone
  const ctx2 = await newContext(browser);
  const p2 = await ctx2.newPage();
  try {
    await openApp(p2);
    await setup(p2);
    await code(p2, '2');
    await save(p2);
    await tab(p2, 'settings');
    await p2.fill('#backupText', 'nesmysl');
    await tap(p2, '#mergeBackup');
    assert.match(await p2.textContent('#backupMsg'), /není záloha/);
    await p2.fill('#backupText', backup);
    await tap(p2, '#mergeBackup');
    assert.match(await p2.textContent('#backupMsg'), /Přičteno 5 lístků \(0 záznamů už tu bylo\)/);
    let r = await results(p2);
    assert.deepEqual([r.total, r.valid, r.votes], [6, 6, 3 + 2 + 3 * 2 + 3]);
    await tab(p2, 'settings');
    await tap(p2, '#mergeBackup');
    assert.match(await p2.textContent('#backupMsg'), /Přičteno 0 lístků \(3 záznamů už tu bylo\)/);
    r = await results(p2);
    assert.equal(r.total, 6);
    expectCands(r, { '1.1': 1, '2.1': 2, '3.1': 4, '3.2': 3 });
    // data survive a reload
    await p2.reload();
    assert.match(await p2.textContent('#hdrInfo'), /^6 lístků · volí se 3/);
  } finally { await ctx2.close(); }
});

test('kód s příjmením nic napůl neoznačí', async page => {
  await setup(page);
  await code(page, '1 alfa');
  assert.equal(await page.inputValue('#code'), '1 alfa');
  await code(page, '2.1');
  assert.match(await statusText(page), /Platný.*Jednotlivě 1 kandidát/);
  await tap(page, '#clearSel');
  // searching by surname still works
  await page.fill('#code', 'alfa');
  await tap(page, '#searchRes .crow[data-k="1:1"]');
  assert.match(await statusText(page), /Jednotlivě 1 kandidát/);
});

test('rozpracovaný lístek přežije obnovení stránky', async page => {
  await setup(page);
  await code(page, '2 1.1');
  await page.reload();
  assert.match(await statusText(page), /Strana 2 Strana B \+ 1 kand\. jiných stran/);
});

test('Vyfotit lístek: v aplikaci je ballot.py beze změny', async page => {
  // the app runs the embedded copy; tools/embed-ballot.py copies the file after a change
  const py = fs.readFileSync(path.join(ROOT, 'ballot.py'), 'utf8');
  const embedded = await page.evaluate(() => document.getElementById('ballot-py').textContent.replace(/^\n/, ''));
  assert.ok(embedded === py, 'index.html #ballot-py differs from ballot.py – run: python3 tools/embed-ballot.py');
});

test('PWA: manifest, ikony a service worker', async page => {
  const m = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.webmanifest'), 'utf8'));
  assert.equal(m.name, 'Sčítání hlasů Praha');
  assert.equal(m.short_name, 'Sčítání');
  assert.equal(m.display, 'standalone');
  assert.equal(m.start_url, './');
  assert.equal(m.scope, './');
  assert.equal(m.theme_color, '#c4306c');
  assert.equal(m.background_color, '#e9ebee');
  assert.ok(m.icons.some(i => i.purpose === 'maskable'));
  for (const i of m.icons) {
    const buf = fs.readFileSync(path.join(ROOT, i.src));
    const [w, h] = [buf.readUInt32BE(16), buf.readUInt32BE(20)];
    assert.equal(`${w}x${h}`, i.sizes, i.src);
  }
  const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  for (const f of ['index.html', 'manifest.webmanifest', ...m.icons.map(i => i.src)]) assert.ok(sw.includes(`'./${f}'`), `sw.js precaches ${f}`);
  // every precached file exists
  for (const f of sw.match(/'\.\/[^']+'/g).map(s => s.slice(3, -1)).filter(Boolean)) assert.ok(fs.existsSync(path.join(ROOT, f)), `${f} exists`);
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  for (const line of html.split('\n').filter(l => /rel="(manifest|apple-touch-icon|icon)"/.test(l))) assert.match(line, /<!--wrap-->$/, line);
  // on file:// no service worker is registered (and no error is thrown)
  assert.equal(await page.evaluate(async () => {
    try { return (await navigator.serviceWorker.getRegistrations()).length; } catch { return 0; }
  }), 0);
});

test('PWA: po prvním načtení funguje offline (localhost)', async (page, ctx, browser) => {
  const http = require('http');
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
  const server = http.createServer((req, res) => {
    let f = decodeURIComponent(new globalThis.URL(req.url, 'http://x').pathname);
    if (f.endsWith('/')) f += 'index.html';
    const file = path.join(ROOT, path.normalize(f));
    if (!file.startsWith(ROOT) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(r => server.listen(0, 'localhost', r));
  const base = `http://localhost:${server.address().port}/`;
  const c = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
    const p = await c.newPage();
    p.setDefaultTimeout(10000);
    await p.goto(base);
    await p.evaluate(() => navigator.serviceWorker.ready);
    await p.waitForFunction(() => !!navigator.serviceWorker.controller);
    const keys = await p.evaluate(() => caches.keys());
    assert.ok(keys.some(k => k.startsWith('scitani-shell-')), 'shell cache exists');
    await code(p, '1');
    await save(p);
    await new Promise(r => server.close(r));
    server.closeAllConnections?.();
    await c.setOffline(true);
    await p.reload();
    await p.waitForSelector('#ballot .party');
    assert.match(await p.textContent('#hdrInfo'), /^1 lístek/);
    assert.ok(await p.evaluate(async () => !!(await fetch('icons/icon-512.png')).ok));
  } finally { await c.close(); server.close(); }
});

/* ---------- runner ---------- */
async function newContext(browser) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, locale: 'cs-CZ' });
  // no network: the app must work without Google Fonts
  await ctx.route(/^https?:/, r => r.abort());
  return ctx;
}
async function openApp(page) {
  await page.goto(URL);
  await page.waitForSelector('#ballot .party');
}

(async () => {
  const browser = await playwright.chromium.launch();
  const only = process.argv[2];
  let pass = 0, fail = 0;
  const failures = [];
  for (const t of tests) {
    if (only && !t.name.includes(only)) continue;
    const ctx = await newContext(browser);
    const page = await ctx.newPage();
    page.setDefaultTimeout(5000);
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    const t0 = Date.now();
    try {
      await openApp(page);
      await t.fn(page, ctx, browser);
      if (errors.length) throw new Error('JS chyba na stránce: ' + errors.join('; '));
      pass++;
      console.log(`  ✓ ${t.name} (${Date.now() - t0} ms)`);
    } catch (e) {
      fail++;
      failures.push([t.name, e]);
      console.log(`  ✗ ${t.name}\n      ${String(e.message).split('\n').join('\n      ')}`);
    } finally {
      await ctx.close();
    }
  }
  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed, ${pass + fail} total`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
