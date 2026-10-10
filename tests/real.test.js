#!/usr/bin/env node
/* Regression tests for "Vyfotit lístek" on real phone photos (tests/fixtures/).
   Run: npm run test:real   (or: node tests/real.test.js)
   ballot-21-24: four photos of the same marked test ballot, page with parties 21–24, taken from
   different angles (photo 3 is skewed, the lower half of the folded page shifted sideways).
   Crosses: 21 party box + candidate 4; 22 candidates 22, 29; 23 candidate 28; 24 party box +
   candidates 28, 35. Party 21's box sits ~25 lines above its candidates (long manifesto).
   The photos are read by ballot.py (under Pyodide, served from tests/.pyodide): on photo 3 it does not
   find the frame of party 21 and reads parties 22–24 only. */
'use strict';
const path = require('path');
const fs = require('fs');
const assert = require('assert/strict');

let playwright;
try { playwright = require('/opt/node-tools/node_modules/playwright'); } catch { playwright = require('playwright'); }
// APP=<path> runs the tests against another copy of the app (e.g. an older version)
const { routePyodide } = require('./pyodide');
const URL = 'file://' + (process.env.APP ? path.resolve(process.env.APP) : path.join(path.resolve(__dirname, '..'), 'index.html'));
const DIR = path.join(__dirname, 'fixtures', 'ballot-21-24');
const PHOTOS = [1, 2, 3, 4].map(i => path.join(DIR, `photo-${i}.jpg`));
const EXPECT = {
  21: { party: true, cands: [4] },
  22: { party: false, cands: [22, 29] },
  23: { party: false, cands: [28] },
  24: { party: true, cands: [28, 35] }
};

async function evaluate(page, files) {
  await page.click('#scanOpen');
  await page.setInputFiles('#scanGallery', files.map(f => ({ name: path.basename(f), mimeType: 'image/jpeg', buffer: fs.readFileSync(f) })));
  await page.click('#scanRun');
  await page.waitForFunction(() => document.getElementById('scanPanel')._scan, null, { timeout: 180000 });
  return page.$$eval('#scanPages .scan-page', els => els.map(el => ({
    title: el.querySelector('h3').textContent,
    error: el.querySelector('[data-error]') ? el.querySelector('[data-error]').textContent : '',
    parties: Object.fromEntries([...el.querySelectorAll('.scan-sum li[data-p]')].map(li => [li.dataset.p,
      { party: li.dataset.party === '1', cands: li.dataset.cands ? li.dataset.cands.split(',').map(Number) : [], read: li.dataset.read === '1' }]))
  })));
}
// photo 3: ballot.py misses the frame of party 21
const SEEN = i => i === 2 ? ['22', '23', '24'] : ['21', '22', '23', '24'];
function expectPage(p, i) {
  const label = `fotka ${i + 1}`;
  assert.equal(p.error, '', `${label}: chyba`);
  assert.deepEqual(Object.keys(p.parties).sort(), SEEN(i), `${label}: strany`);
  for (const n of SEEN(i)) assert.deepEqual(p.parties[n], { ...EXPECT[n], read: true }, `${label}: strana ${n}`);
}

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
PHOTOS.forEach((f, i) => test(`fotka ${i + 1} samotná`, async page => {
  const [p] = await evaluate(page, [f]);
  expectPage(p, i);
}));
/* ballot-21-24-sloppy: the same photos with sloppy crosses painted on (tools/sloppy-crosses.py): thick
   strokes running into the text, the next boxes and over the frame. The old ballot.py left columns
   NOT READ (boxes it could not separate, a frame joined to the photo edge); every box must be there. */
const SLOPPY = {
  'sloppy-1.jpg': '21:10 22:13 22:61 24:25 24:39 24:60', 'sloppy-2.jpg': '21:10 21:12 22:32 22:35 23:6 24:24',
  'sloppy-3.jpg': '21:14 22:19 22:35 24:16 24:3 24:57', 'sloppy-4.jpg': '21:7 22:5 22:30 22:50 23:12 23:33 24:3 24:44 24:60'
};
for (const [f, extra] of Object.entries(SLOPPY)) test(`neúhledné křížky: ${f}`, async page => {
  const exp = JSON.parse(JSON.stringify(EXPECT));
  for (const k of extra.split(' ')) { const [p, c] = k.split(':'); exp[p].cands.push(+c); }
  const [p] = await evaluate(page, [path.join(__dirname, 'fixtures', 'ballot-21-24-sloppy', f)]);
  assert.equal(p.error, '', 'chyba');
  for (const [n, e] of Object.entries(exp)) {
    e.cands.sort((a, b) => a - b);
    assert.deepEqual(p.parties[n], { ...e, read: true }, `strana ${n}`);
  }
});
test('všechny čtyři fotky najednou, Použít na lístek', async page => {
  const pages = await evaluate(page, PHOTOS);
  assert.equal(pages.length, 4);
  pages.forEach(expectPage);
  await page.click('#scanApply');
  const d = await page.evaluate(() => JSON.parse(localStorage.getItem('volby-praha-draft-v1') || '{}'));
  assert.deepEqual(d.parties.sort((a, b) => a - b), [21, 24]);
  assert.deepEqual(d.cands.sort(), ['21:4', '22:22', '22:29', '23:28', '24:28', '24:35']);
  assert.match(await page.textContent('#status'), /Neplatný/); // two parties marked – the counting rules still apply
});

(async () => {
  const browser = await playwright.chromium.launch();
  const only = process.argv[2];
  let pass = 0, fail = 0;
  for (const t of tests) {
    if (only && !t.name.includes(only)) continue;
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'cs-CZ' });
    await ctx.route(/^https?:/, r => r.abort());
    await routePyodide(ctx);
    const page = await ctx.newPage();
    page.setDefaultTimeout(60000);
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    const t0 = Date.now();
    try {
      await page.goto(URL);
      await t.fn(page);
      if (errors.length) throw new Error('Chyba v aplikaci: ' + errors.join('; '));
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
