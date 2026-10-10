#!/usr/bin/env node
/* Tests for "Vyfotit lístek" (recognising crosses from photos of ballot pages), driven through Playwright + Chromium.
   Run: npm run test:scan   (or: node tests/scan.test.js)
   No image files needed: each test draws a synthetic photo of a ballot page (two columns =
   parties 1 and 2 of the built-in list, 10 and 3 candidates), adds pencil crosses, rotates it,
   changes the light and recompresses it as JPEG, feeds it to the file input and checks the result.
   SCAN_SEED=<n> draws different random crosses. */
'use strict';
const path = require('path');
const assert = require('assert/strict');

let playwright;
try { playwright = require('/opt/node-tools/node_modules/playwright'); } catch { playwright = require('playwright'); }
const URL = 'file://' + path.join(path.resolve(__dirname, '..'), 'index.html');

/* Draws the photo inside the page and returns it as base64 JPEG.
   marks: keys "1:P" (party box of the left column), "2:3" (candidate 3 of the right column) … */
async function photo(page, marks, v = {}) {
  return page.evaluate(({ marks, v, seed0 }) => {
    let s = (v.seed || 1) + seed0 * 7919;
    const rnd = () => { s = (s * 1103515245 + 12345) >>> 0; return (s >>> 8) / 16777216; };
    const W = 1200, H = 1600, a = document.createElement('canvas'); a.width = W; a.height = H;
    const c = a.getContext('2d');
    // paper with a slight light gradient, magenta stripe, column frames, header text
    const gr = c.createLinearGradient(0, 0, W, H); gr.addColorStop(0, '#f1f1ee'); gr.addColorStop(1, '#dcdcd8');
    c.fillStyle = gr; c.fillRect(0, 0, W, H);
    c.fillStyle = '#d0307a'; c.fillRect(40, 0, 34, H);
    c.fillStyle = '#333'; c.font = '20px sans-serif'; c.fillText('Hlavní město Praha', 110, 70);
    c.strokeStyle = '#333'; c.lineWidth = 1.6;
    // v.cols: candidate boxes per column (default parties 1 and 2: 10 and 3); long lists get a tighter pitch
    const box = [], cols = (v.cols || [10, 3]).map((n, i) => [110 + i * 510, n]);
    cols.forEach(([x, n], ci) => {
      c.strokeRect(x, 100, 480, 1450);
      const bx = x + 14, bw = 34;
      box.push({ key: `${ci + 1}:P`, x: bx, y: 114, w: bw, h: 34 });
      c.font = 'bold 16px sans-serif'; c.fillText(`STRANA ${ci + 1} – NÁZEV STRANY`, bx + 50, 128);
      c.font = '13px sans-serif'; c.fillText(`vylosované číslo: ${ci + 1}`, bx + 50, 148);
      // v.pitch: the same pitch for every column (as on the real ballot); v.fold: {y, gap} – the page is
      // folded at y: boxes below move down by gap and a crease (shadow + highlight) crosses the page
      const pitch = v.pitch || Math.min(25, 1340 / n), bh = Math.min(17, Math.round(pitch * 0.7));
      for (let i = 0; i < n; i++) {
        let y = Math.round(180 + i * pitch);
        if (v.fold && y >= v.fold.y) y += v.fold.gap;
        box.push({ key: `${ci + 1}:${i + 1}`, x: bx, y, w: bw, h: bh });
        c.font = 'bold 13px sans-serif'; c.fillText(`${i + 1}. Jméno Příjmení, ${30 + i} let`, bx + 46, y + 9);
        if (pitch >= 24) { c.font = '12px sans-serif'; c.fillText('Praha 1, bez politické příslušnosti', bx + 60, y + 21); }
      }
    });
    box.forEach(b => c.strokeRect(b.x, b.y, b.w, b.h));
    if (v.fold) {
      const fy = v.fold.y + v.fold.gap / 2 + (v.fold.crease ?? (v.fold.fake ? -10 : 0)), g = c.createLinearGradient(0, fy - 9, 0, fy + 9);
      g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.42, 'rgba(30,30,30,0.6)'); g.addColorStop(0.5, 'rgba(30,30,30,0.7)');
      g.addColorStop(0.6, 'rgba(255,255,255,0.5)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = g; c.fillRect(0, fy - 9, W, 18);
      // the crease itself: two sharp edges about half a box apart (this is what fakes a flat box)
      c.fillStyle = 'rgba(60,60,60,0.3)'; c.fillRect(0, fy - 4, W, 8);
      c.fillStyle = 'rgba(45,45,45,0.9)'; c.fillRect(0, fy - 5, W, 2); c.fillRect(0, fy + 3, W, 2);
      // v.fold.fake: columns where the fold shows up as a flat empty box in the middle of the gap (as on a real photo)
      (v.fold.fake || []).forEach(ci => { c.lineWidth = 1.6; c.strokeRect(110 + ci * 510 + 14, fy + (v.fold.fakeAt ?? 15), 34, 8); });
    }
    // pencil crosses, strokes ending a bit inside or over the border
    const stroke = (x1, y1, x2, y2) => {
      for (let k = 0; k < 2; k++) {
        const j = () => (rnd() - 0.5) * 2.5;
        c.beginPath(); c.moveTo(x1 + j(), y1 + j());
        c.quadraticCurveTo((x1 + x2) / 2 + (rnd() - 0.5) * 5, (y1 + y2) / 2 + (rnd() - 0.5) * 5, x2 + j(), y2 + j());
        c.strokeStyle = 'rgba(55,55,60,0.8)'; c.lineWidth = 3; c.lineCap = 'round'; c.stroke();
      }
    };
    box.filter(b => marks.includes(b.key)).forEach(b => {
      const o = () => -0.1 + rnd() * 0.3;
      stroke(b.x - o() * b.w, b.y - o() * b.h, b.x + b.w + o() * b.w, b.y + b.h + o() * b.h);
      stroke(b.x + b.w + o() * b.w, b.y - o() * b.h, b.x - o() * b.w, b.y + b.h + o() * b.h);
    });
    if (v.light) { // brightness / contrast
      const d = c.getImageData(0, 0, W, H), p = d.data;
      for (let i = 0; i < p.length; i += 4) for (let k = 0; k < 3; k++) p[i + k] = ((p[i + k] - 128) * v.light[1] + 128) * v.light[0];
      c.putImageData(d, 0, 0);
    }
    // handheld photo: page rotated on a wooden table, optionally smaller
    const k = v.scale || 1, out = document.createElement('canvas'); out.width = Math.round(W * k); out.height = Math.round(H * k);
    const o = out.getContext('2d');
    o.fillStyle = '#6d5a48'; o.fillRect(0, 0, out.width, out.height);
    o.translate(out.width / 2, out.height / 2); o.rotate((v.rot || 0) * Math.PI / 180); o.scale(k * 0.97, k * 0.97); o.drawImage(a, -W / 2, -H / 2);
    return out.toDataURL('image/jpeg', v.q || 0.85).split(',')[1];
  }, { marks, v, seed0: +(process.env.SCAN_SEED || 0) });
}

let shot = 0;
// the result of the last photo in the scan panel
const LAST = '#scanPages .scan-page:last-child';
async function addPhoto(page, b64) {
  // SCAN_SAVE=<dir>: keep the generated photos and the overlay previews for inspection
  if (process.env.SCAN_SAVE) require('fs').writeFileSync(path.join(process.env.SCAN_SAVE, `photo-${++shot}.jpg`), Buffer.from(b64, 'base64'));
  if (await page.isHidden('#scanPanel')) await page.click('#scanOpen');
  await page.setInputFiles('#scanFile', { name: 'foto.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(b64, 'base64') });
}
async function run(page) {
  await page.evaluate(() => { delete document.getElementById('scanPanel')._scan; });
  await page.click('#scanRun');
  await page.waitForFunction(() => document.getElementById('scanPanel')._scan);
}
const parseSum = sel => page => page.$$eval(sel, els => Object.fromEntries(els.filter(e => e.dataset.p).map(e => [e.dataset.p,
  { party: e.dataset.party === '1', cands: e.dataset.cands ? e.dataset.cands.split(',').map(Number) : [], boxes: +e.dataset.boxes }])));
// one photo: drop the photos already in the panel, add this one, evaluate, return the summary
async function scan(page, b64) {
  while (await page.$('#scanThumbs [data-del]')) await page.click('#scanThumbs [data-del]');
  await addPhoto(page, b64);
  await run(page);
  if (process.env.SCAN_SAVE && await page.$(`${LAST} canvas`)) await (await page.$(`${LAST} canvas`)).screenshot({ path: path.join(process.env.SCAN_SAVE, `overlay-${shot}.png`) });
  return parseSum(`${LAST} .scan-sum li[data-p]`)(page);
}

function expectScan(got, exp) {
  for (const p of ['1', '2']) {
    const e = exp[p] || { party: false, cands: [] };
    assert.ok(got[p], `strana ${p}: sloupec nenalezen`);
    assert.equal(got[p].boxes, p === '1' ? 10 : 3, `strana ${p}: počet políček kandidátů`);
    assert.equal(got[p].party, e.party, `strana ${p}: křížek u strany`);
    assert.deepEqual(got[p].cands, e.cands, `strana ${p}: kandidáti`);
  }
}

const MARKS = ['1:2', '1:7', '1:10', '2:P'], EXP = { 1: { party: false, cands: [2, 7, 10] }, 2: { party: true, cands: [] } };
const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('prázdný lístek: žádné křížky', async page => expectScan(await scan(page, await photo(page, [])), {}));
test('křížky, rovná fotka', async page => expectScan(await scan(page, await photo(page, MARKS, { seed: 2 })), EXP));
test('křížky, otočeno o +3°', async page => expectScan(await scan(page, await photo(page, MARKS, { seed: 3, rot: 3 })), EXP));
test('křížky, otočeno o −3°, tmavší a méně kontrastní', async page =>
  expectScan(await scan(page, await photo(page, MARKS, { seed: 4, rot: -3, light: [0.75, 0.8] })), EXP));
test('křížky, malá silně komprimovaná fotka', async page =>
  expectScan(await scan(page, await photo(page, MARKS, { seed: 5, rot: 2, scale: 0.6, q: 0.5 })), EXP));
test('všichni kandidáti pravého sloupce zaškrtnutí', async page =>
  expectScan(await scan(page, await photo(page, ['1:P', '2:1', '2:2', '2:3'], { seed: 6, rot: -2 })), { 1: { party: true, cands: [] }, 2: { party: false, cands: [1, 2, 3] } }));
test('Použít: přenese křížky na lístek, nic neuloží', async page => {
  await scan(page, await photo(page, MARKS, { seed: 7, rot: 1 }));
  await page.click('#scanApply');
  assert.ok(await page.isHidden('#scanPanel'));
  const st = await page.evaluate(() => ({ draft: JSON.parse(localStorage.getItem('volby-praha-draft-v1') || '{}'),
    saved: JSON.parse(localStorage.getItem('volby-praha-ballots-v1') || '[]').length }));
  assert.deepEqual(st.draft.parties, [2]);
  assert.deepEqual([...st.draft.cands].sort(), ['1:10', '1:2', '1:7']);
  assert.equal(st.saved, 0);
  assert.equal(await page.getAttribute('.crow[data-k="1:7"]', 'aria-pressed'), 'true');
});
test('levý sloupec ručně přepnut na jinou stranu: varování o počtu políček', async page => {
  await scan(page, await photo(page, ['1:1'], { seed: 8 }));
  assert.equal(await page.inputValue(`${LAST} .scan-first`), '1');
  await page.selectOption(`${LAST} .scan-first`, '2');
  assert.match(await page.textContent(`${LAST} .scan-sum`), /kandidátů je jen 3/);
  assert.equal(await page.getAttribute(`${LAST} .scan-guess .msg`, 'data-status'), 'manual');
});

/* guessing the parties from the number of boxes per column (the built-in 2026 list) */
const guess = async page => ({
  first: await page.inputValue(`${LAST} .scan-first`),
  status: await page.getAttribute(`${LAST} .scan-guess .msg`, 'data-status'),
  chips: await page.$$eval(`${LAST} .scan-guess [data-s]`, els => els.map(e => e.textContent)),
  sum: await page.textContent(`${LAST} .scan-sum`)
});
test('odhad stran: 10 a 3 políčka → strany 1–2', async page => {
  await scan(page, await photo(page, [], { seed: 9 }));
  const g = await guess(page);
  assert.deepEqual([g.first, g.status], ['1', 'sure']);
});
test('odhad stran: 15 a 1 políčko → strany 3–4', async page => {
  await scan(page, await photo(page, ['1:15', '2:1'], { seed: 10, cols: [15, 1], rot: 2 }));
  const g = await guess(page);
  assert.deepEqual([g.first, g.status], ['3', 'sure']);
  assert.doesNotMatch(g.sum, /zkontrolujte|nenalezeno/i);
  assert.match(g.sum, /Strana 3: kandidáti 15/);
  assert.match(g.sum, /Strana 4: kandidáti 1/);
});
test('odhad stran: 65 a 50 políček → strany 12–13', async page => {
  await scan(page, await photo(page, ['1:P', '2:50'], { seed: 11, cols: [65, 50] }));
  const g = await guess(page);
  assert.deepEqual([g.first, g.status], ['12', 'sure']);
  assert.match(g.sum, /Strana 12: křížek u strany/);
  assert.match(g.sum, /Strana 13: kandidáti 50/);
});
test('odhad stran: 65 a 65 políček je víc možností – nabídka a navázání na předchozí stránku', async page => {
  await scan(page, await photo(page, [], { seed: 12, cols: [65, 65] }));
  let g = await guess(page);
  assert.equal(g.status, 'ambiguous');
  assert.equal(g.first, '9'); // nothing on the ballot yet → the first such page
  for (const r of ['9–10', '10–11', '14–15', '15–16', '18–19', '19–20']) assert.ok(g.chips.includes(r), `nabídka ${r}`);
  await page.click(`${LAST} .scan-guess [data-s="13"]`); // tap 14–15
  g = await guess(page);
  assert.equal(g.first, '14');
  // a page 12–13 applied first → the next 65+65 page is guessed as 14–15
  await scan(page, await photo(page, ['1:P'], { seed: 13, cols: [65, 50] }));
  await page.click('#scanApply');
  await scan(page, await photo(page, [], { seed: 14, cols: [65, 65] }));
  g = await guess(page);
  assert.deepEqual([g.first, g.status], ['14', 'ambiguous']);
  assert.match(await page.textContent(`${LAST} .scan-guess`), /navazuje na předchozí stránku/);
});

/* the ballot is folded between candidates 42 and 43 (as on the real Prague ballot, page with parties 21–24) */
const FOLD = { cols: [65, 41], pitch: 19.5 };
test('přehyb: falešné políčko na přehybu se vynechá, kandidáti pod přehybem sedí', async page => {
  const got = await scan(page, await photo(page, ['1:42', '1:45', '2:41'], { ...FOLD, seed: 1, fold: { y: 1020, gap: 54, fake: [0, 1], crease: -4, fakeAt: 6 } }));
  assert.equal(await page.inputValue(`${LAST} .scan-first`), '22');
  assert.deepEqual(got['22'].cands, [42, 45]);
  assert.deepEqual(got['23'].cands, [41]);
  assert.equal(got['22'].boxes, 65);
  assert.equal(got['23'].boxes, 41);
  assert.match(await page.textContent(`${LAST} .scan-sum`), /Vynecháno 1 falešné políčko/);
});
test('přehyb: přehlédnuté políčko se doplní, kandidáti pod ním sedí', async page => {
  const got = await scan(page, await photo(page, ['1:42', '1:45', '2:41'], { ...FOLD, seed: 1, fold: { y: 1020, gap: 54, fake: [0, 1], crease: -10, fakeAt: 10 } }));
  assert.deepEqual(got['22'].cands, [42, 45]);
  assert.equal(got['22'].boxes, 65);
});
test('přehyb, natočená fotka', async page => {
  const got = await scan(page, await photo(page, ['1:43', '1:65', '1:42', '2:P'], { ...FOLD, seed: 2, rot: 2, fold: { y: 1020, gap: 54, fake: [0, 1], crease: -4, fakeAt: 6 } }));
  assert.deepEqual(got['22'].cands, [42, 43, 65]);
  assert.equal(got['23'].party, true);
  assert.deepEqual([got['22'].boxes, got['23'].boxes], [65, 41]);
});

/* several photos of one ballot, evaluated together */
const PAGE = i => `#scanPages .scan-page[data-i="${i}"]`;
const pageGuess = async (page, i) => ({
  first: await page.inputValue(`${PAGE(i)} .scan-first`),
  status: await page.getAttribute(`${PAGE(i)} .scan-guess .msg`, 'data-status'),
  text: await page.textContent(`${PAGE(i)} .scan-guess`),
  sum: await parseSum(`${PAGE(i)} .scan-sum li[data-p]`)(page)
});
test('více fotek: tři stránky najednou, Použít přenese křížky ze všech', async page => {
  await addPhoto(page, await photo(page, ['1:P', '2:2'], { seed: 21 }));
  await addPhoto(page, await photo(page, ['1:15'], { seed: 22, cols: [15, 1], rot: 2 }));
  await addPhoto(page, await photo(page, ['1:3', '2:P'], { seed: 23, cols: [65, 4], rot: -2 }));
  assert.equal(await page.$$eval('#scanThumbs .scan-thumb', e => e.length), 3);
  assert.match(await page.textContent('#scanRun'), /3 fotky/);
  await run(page);
  const g = [await pageGuess(page, 0), await pageGuess(page, 1), await pageGuess(page, 2)];
  assert.deepEqual(g.map(x => [x.first, x.status]), [['1', 'sure'], ['3', 'sure'], ['5', 'sure']]);
  assert.deepEqual(g[0].sum['1'], { party: true, cands: [], boxes: 10 });
  assert.deepEqual(g[0].sum['2'].cands, [2]);
  assert.deepEqual(g[1].sum['3'].cands, [15]);
  assert.deepEqual(g[2].sum['5'].cands, [3]);
  assert.equal(g[2].sum['6'].party, true);
  assert.match(await page.textContent('#scanThumbs'), /strany 1–2[\s\S]*strany 3–4[\s\S]*strany 5–6/);
  await page.click('#scanApply');
  assert.ok(await page.isHidden('#scanPanel'));
  const d = await page.evaluate(() => JSON.parse(localStorage.getItem('volby-praha-draft-v1') || '{}'));
  assert.deepEqual(d.parties.sort((a, b) => a - b), [1, 6]);
  assert.deepEqual(d.cands.sort(), ['2:2', '3:15', '5:3']);
  assert.match(await page.textContent('#status'), /Neplatný/); // two parties marked – the rules still apply
  await page.click('#scanOpen');
  assert.equal(await page.$$eval('#scanThumbs .scan-thumb', e => e.length), 0); // photos are cleared after use
});
test('více fotek: nejednoznačné stránky 65+65 navazují, ruční volba posune další fotku', async page => {
  await addPhoto(page, await photo(page, [], { seed: 24, cols: [65, 65] }));
  await addPhoto(page, await photo(page, [], { seed: 25, cols: [65, 65], rot: 1 }));
  await run(page);
  let a = await pageGuess(page, 0), b = await pageGuess(page, 1);
  assert.deepEqual([a.first, a.status, b.first, b.status], ['9', 'ambiguous', '11', 'ambiguous']);
  assert.match(b.text, /navazuje na předchozí fotku/);
  await page.click(`${PAGE(0)} .scan-guess [data-s="13"]`); // the first photo is 14–15
  a = await pageGuess(page, 0); b = await pageGuess(page, 1);
  assert.deepEqual([a.first, a.status, b.first], ['14', 'manual', '18']); // 16–17 is not a 65+65 page → next one, 18–19
});
test('více fotek: nejvýš 8, odebrání fotky', async page => {
  const b64 = await photo(page, [], { seed: 26, scale: 0.4 });
  await page.click('#scanOpen');
  await page.setInputFiles('#scanGallery', Array.from({ length: 9 }, (_, i) => ({ name: `f${i}.jpg`, mimeType: 'image/jpeg', buffer: Buffer.from(b64, 'base64') })));
  assert.equal(await page.$$eval('#scanThumbs .scan-thumb', e => e.length), 8);
  assert.match(await page.textContent('#scanMsg'), /nejvýše 8 fotek – 1 se nepřidalo/);
  assert.ok(await page.isDisabled('#scanFile'));
  await page.click('#scanThumbs [data-del="0"]');
  assert.equal(await page.$$eval('#scanThumbs .scan-thumb', e => e.length), 7);
  assert.ok(!(await page.isDisabled('#scanFile')));
});
test('více fotek: stejná stránka dvakrát – platí pozdější fotka', async page => {
  await addPhoto(page, await photo(page, ['1:1'], { seed: 27 }));
  await addPhoto(page, await photo(page, ['1:2'], { seed: 28, rot: 1 }));
  await run(page);
  const b = await pageGuess(page, 1);
  assert.equal(b.first, '1');
  assert.match(await page.textContent(`${PAGE(1)} .scan-sum`), /Strana 1 je i na fotce 1 – použije se tato/);
  await page.click('#scanApply');
  const d = await page.evaluate(() => JSON.parse(localStorage.getItem('volby-praha-draft-v1') || '{}'));
  assert.deepEqual(d.cands, ['1:2']);
});

(async () => {
  const browser = await playwright.chromium.launch();
  const only = process.argv[2];
  let pass = 0, fail = 0;
  for (const t of tests) {
    if (only && !t.name.includes(only)) continue;
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'cs-CZ' });
    await ctx.route(/^https?:/, r => r.abort());
    const page = await ctx.newPage();
    page.setDefaultTimeout(20000);
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    const t0 = Date.now();
    try {
      await page.goto(URL);
      await t.fn(page);
      assert.deepEqual(errors, [], 'chyby v konzoli');
      pass++; console.log(`  ✓ ${t.name} (${Date.now() - t0} ms)`);
    } catch (e) {
      fail++; console.log(`  ✗ ${t.name}\n    ${String(e.message).split('\n').join('\n    ')}`);
    }
    await ctx.close();
  }
  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed, ${pass + fail} total`);
  process.exit(fail ? 1 : 0);
})();
