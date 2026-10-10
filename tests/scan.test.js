#!/usr/bin/env node
/* Tests for the experimental "Skenovat foto" feature, driven through Playwright + Chromium.
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
      const pitch = Math.min(25, 1340 / n), bh = Math.min(17, Math.round(pitch * 0.7));
      for (let i = 0; i < n; i++) {
        const y = Math.round(180 + i * pitch);
        box.push({ key: `${ci + 1}:${i + 1}`, x: bx, y, w: bw, h: bh });
        c.font = 'bold 13px sans-serif'; c.fillText(`${i + 1}. Jméno Příjmení, ${30 + i} let`, bx + 46, y + 9);
        if (pitch >= 24) { c.font = '12px sans-serif'; c.fillText('Praha 1, bez politické příslušnosti', bx + 60, y + 21); }
      }
    });
    box.forEach(b => c.strokeRect(b.x, b.y, b.w, b.h));
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
async function scan(page, b64) {
  // SCAN_SAVE=<dir>: keep the generated photos and the overlay previews for inspection
  if (process.env.SCAN_SAVE) require('fs').writeFileSync(path.join(process.env.SCAN_SAVE, `photo-${++shot}.jpg`), Buffer.from(b64, 'base64'));
  await page.evaluate(() => { delete document.getElementById('scanPanel')._scan; });
  if (await page.isHidden('#scanPanel')) await page.click('#scanOpen');
  await page.setInputFiles('#scanFile', { name: 'foto.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(b64, 'base64') });
  await page.waitForFunction(() => document.getElementById('scanPanel')._scan || /bad/.test(document.getElementById('scanMsg').className));
  if (process.env.SCAN_SAVE) await (await page.$('#scanCanvas')).screenshot({ path: path.join(process.env.SCAN_SAVE, `overlay-${shot}.png`) });
  return page.$$eval('#scanSum li[data-p]', els => Object.fromEntries(els.filter(e => e.dataset.p).map(e => [e.dataset.p,
    { party: e.dataset.party === '1', cands: e.dataset.cands ? e.dataset.cands.split(',').map(Number) : [], boxes: +e.dataset.boxes }])));
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
  assert.equal(await page.inputValue('#scanFirst'), '1');
  await page.selectOption('#scanFirst', '2');
  assert.match(await page.textContent('#scanSum'), /kandidátů je jen 3/);
  assert.equal(await page.getAttribute('#scanGuess .msg', 'data-status'), 'manual');
});

/* guessing the parties from the number of boxes per column (the built-in 2026 list) */
const guess = async page => ({
  first: await page.inputValue('#scanFirst'),
  status: await page.getAttribute('#scanGuess .msg', 'data-status'),
  chips: await page.$$eval('#scanGuess [data-s]', els => els.map(e => e.textContent)),
  sum: await page.textContent('#scanSum')
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
  await page.click('#scanGuess [data-s="13"]'); // tap 14–15
  g = await guess(page);
  assert.equal(g.first, '14');
  // a page 12–13 applied first → the next 65+65 page is guessed as 14–15
  await scan(page, await photo(page, ['1:P'], { seed: 13, cols: [65, 50] }));
  await page.click('#scanApply');
  await scan(page, await photo(page, [], { seed: 14, cols: [65, 65] }));
  g = await guess(page);
  assert.deepEqual([g.first, g.status], ['14', 'ambiguous']);
  assert.match(await page.textContent('#scanGuess'), /navazuje na předchozí stránku/);
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
