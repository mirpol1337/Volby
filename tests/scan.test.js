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
const { routePyodide } = require('./pyodide');
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
  // SCAN_SAVE=<dir>: keep the generated photos and ballot.py's annotated photos for inspection
  if (process.env.SCAN_SAVE) require('fs').writeFileSync(path.join(process.env.SCAN_SAVE, `photo-${++shot}.jpg`), Buffer.from(b64, 'base64'));
  if (await page.isHidden('#scanPanel')) await page.click('#scanOpen');
  await page.setInputFiles('#scanFile', { name: 'foto.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(b64, 'base64') });
}
// evaluation (or a re-run after choosing the left-column party) finished
const done = page => page.waitForFunction(() => document.getElementById('scanPanel')._scan, null, { timeout: 120000 });
async function run(page) {
  await page.evaluate(() => { delete document.getElementById('scanPanel')._scan; });
  await page.click('#scanRun');
  await done(page);
}
async function pickFirst(page, i, party) {
  await page.evaluate(() => { delete document.getElementById('scanPanel')._scan; });
  await page.selectOption(`#scanFirst${i}`, String(party));
  await done(page);
}
const parseSum = sel => page => page.$$eval(sel, els => Object.fromEntries(els.filter(e => e.dataset.p).map(e => [e.dataset.p,
  { party: e.dataset.party === '1', cands: e.dataset.cands ? e.dataset.cands.split(',').map(Number) : [], boxes: +e.dataset.boxes, read: e.dataset.read === '1' }])));
// one photo: drop the photos already in the panel, add this one, evaluate, return the summary
async function scan(page, b64) {
  while (await page.$('#scanThumbs [data-del]')) await page.click('#scanThumbs [data-del]');
  await addPhoto(page, b64);
  await run(page);
  return parseSum(`${LAST} .scan-sum li[data-p]`)(page);
}

function expectScan(got, exp) {
  for (const p of ['1', '2']) {
    const e = exp[p] || { party: false, cands: [] };
    assert.ok(got[p], `strana ${p}: sloupec nenalezen`);
    assert.equal(got[p].boxes, p === '1' ? 10 : 3, `strana ${p}: počet políček kandidátů`);
    assert.ok(got[p].read, `strana ${p}: přečteno`);
    assert.equal(got[p].party, e.party, `strana ${p}: křížek u strany`);
    assert.deepEqual(got[p].cands, e.cands, `strana ${p}: kandidáti`);
  }
}

const MARKS = ['1:2', '1:7', '1:10', '2:P'], EXP = { 1: { party: false, cands: [2, 7, 10] }, 2: { party: true, cands: [] } };
const tests = [];
const test = (name, fn, opts = {}) => tests.push({ name, fn, ...opts });

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
  assert.match(await page.textContent(`${LAST} h3`), /strany 1–2/);
  assert.ok(await page.$(`${LAST} .scan-view img`), 'náhled z ballot.py');
  await page.click('#scanApply');
  assert.ok(await page.isHidden('#scanPanel'));
  const st = await page.evaluate(() => ({ draft: JSON.parse(localStorage.getItem('volby-praha-draft-v1') || '{}'), saved: JSON.parse(localStorage.getItem('volby-praha-ballots-v1') || '[]').length }));
  assert.deepEqual(st.draft.parties, [2]);
  assert.deepEqual([...st.draft.cands].sort(), ['1:10', '1:2', '1:7']);
  assert.equal(st.saved, 0);
  assert.equal(await page.getAttribute('.crow[data-k="1:7"]', 'aria-pressed'), 'true');
});
test('strany podle počtu políček: 15 a 1 → strany 3–4', async page => {
  const got = await scan(page, await photo(page, ['1:15', '2:1'], { seed: 10, cols: [15, 1], rot: 2 }));
  assert.deepEqual(Object.keys(got), ['3', '4']);
  assert.deepEqual(got['3'].cands, [15]);
  assert.deepEqual(got['4'].cands, [1]);
});
test('strany podle počtu políček: 65 a 50 → strany 12–13', async page => {
  const got = await scan(page, await photo(page, ['1:P', '2:50'], { seed: 11, cols: [65, 50] }));
  assert.deepEqual(Object.keys(got), ['12', '13']);
  assert.equal(got['12'].party, true);
  assert.deepEqual(got['13'].cands, [50]);
});
test('65 a 65 políček: ballot.py se zeptá na stranu v levém sloupci, po výběru přečte', async page => {
  await scan(page, await photo(page, ['2:65'], { seed: 12, cols: [65, 65] }));
  assert.match(await page.textContent(`${LAST} [data-error]`), /odpovídají více stránkám lístku/);
  assert.equal(await page.$(`${LAST} .scan-sum`), null);
  await pickFirst(page, 0, 14); // --first-party 14
  assert.equal(await page.$(`${LAST} [data-error]`), null);
  const got = await parseSum(`${LAST} .scan-sum li[data-p]`)(page);
  assert.deepEqual(Object.keys(got), ['14', '15']);
  assert.deepEqual(got['15'].cands, [65]);
  await pickFirst(page, 0, 24); // no party after 24
  assert.match(await page.textContent(`${LAST} [data-error]`), /Vyberte jinou stranu/);
});
test('sloupec s jiným počtem políček než kandidátů: NEPŘEČTENO, na lístek se nepřenese', async page => {
  // left column 10 boxes = party 1; picking party 5 (65 candidates) makes the column unreadable
  await scan(page, await photo(page, ['1:2', '2:P'], { seed: 15 }));
  await pickFirst(page, 0, 5);
  const got = await parseSum(`${LAST} .scan-sum li[data-p]`)(page);
  assert.equal(got['5'].read, false);
  assert.match(await page.textContent(`${LAST} .scan-sum`), /NEPŘEČTENO/);
  await page.click('#scanApply');
  const d = await page.evaluate(() => JSON.parse(localStorage.getItem('volby-praha-draft-v1') || '{}'));
  assert.ok(!d.cands.some(k => k.startsWith('5:')), 'nepřečtený sloupec se nepřenese');
});
test('více fotek: tři stránky najednou, Použít přenese křížky ze všech', async page => {
  await addPhoto(page, await photo(page, ['1:P', '2:2'], { seed: 21 }));
  await addPhoto(page, await photo(page, ['1:15'], { seed: 22, cols: [15, 1], rot: 2 }));
  await addPhoto(page, await photo(page, ['1:3', '2:P'], { seed: 23, cols: [65, 4], rot: -2 }));
  assert.equal(await page.$$eval('#scanThumbs .scan-thumb', e => e.length), 3);
  assert.match(await page.textContent('#scanRun'), /3 fotky/);
  await run(page);
  assert.match(await page.textContent('#scanThumbs'), /strany 1–2[\s\S]*strany 3–4[\s\S]*strany 5–6/);
  await page.click('#scanApply');
  const d = await page.evaluate(() => JSON.parse(localStorage.getItem('volby-praha-draft-v1') || '{}'));
  assert.deepEqual(d.parties.sort((a, b) => a - b), [1, 6]);
  assert.deepEqual(d.cands.sort(), ['2:2', '3:15', '5:3']);
  assert.match(await page.textContent('#status'), /Neplatný/); // two parties marked – the counting rules still apply
  await page.click('#scanOpen');
  assert.equal(await page.$$eval('#scanThumbs .scan-thumb', e => e.length), 0); // photos are cleared after use
});
test('více fotek: stejná stránka dvakrát – platí pozdější fotka', async page => {
  await addPhoto(page, await photo(page, ['1:1'], { seed: 27 }));
  await addPhoto(page, await photo(page, ['1:2'], { seed: 28, rot: 1 }));
  await run(page);
  assert.match(await page.textContent('#scanPages'), /použije se fotka 2[\s\S]*fotky se u strany 1 liší/);
  await page.click('#scanApply');
  const d = await page.evaluate(() => JSON.parse(localStorage.getItem('volby-praha-draft-v1') || '{}'));
  assert.deepEqual(d.cands, ['1:2']);
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
test('bez internetu: zpráva, že rozpoznání potřebuje připojení', async page => {
  await addPhoto(page, await photo(page, MARKS, { seed: 2 }));
  await run(page);
  assert.match(await page.textContent('#scanMsg'), /potřebuje připojení k internetu/);
  assert.ok(!(await page.isDisabled('#scanRun')), 'lze zkusit znovu');
}, { offline: true });

(async () => {
  const browser = await playwright.chromium.launch();
  const only = process.argv[2];
  let pass = 0, fail = 0;
  for (const t of tests) {
    if (only && !t.name.includes(only)) continue;
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'cs-CZ' });
    await ctx.route(/^https?:/, r => r.abort());
    if (!t.offline) await routePyodide(ctx);
    const page = await ctx.newPage();
    page.setDefaultTimeout(60000);
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
