#!/usr/bin/env node
/* Regression tests for "Vyfotit lístek" on real phone photos (tests/fixtures/).
   Run: npm run test:real   (or: node tests/real.test.js)
   ballot-21-24: four photos of the same marked test ballot, page with parties 21–24, taken from
   different angles (photo 3 is skewed, the lower half of the folded page shifted sideways).
   Crosses: 21 party box + candidate 4; 22 candidates 22, 29; 23 candidate 28; 24 party box +
   candidates 28, 35. Party 21's box sits ~25 lines above its candidates (long manifesto).
   Every photo must also show all boxes of all four columns (14, 65, 41, 65) without repairs. */
'use strict';
const path = require('path');
const fs = require('fs');
const assert = require('assert/strict');

let playwright;
try { playwright = require('/opt/node-tools/node_modules/playwright'); } catch { playwright = require('playwright'); }
// APP=<path> runs the tests against another copy of the app (e.g. an older version)
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
  await page.waitForFunction(() => document.getElementById('scanPanel')._scan, null, { timeout: 60000 });
  return page.$$eval('#scanPages .scan-page', els => els.map(el => ({
    first: el.querySelector('.scan-first') && el.querySelector('.scan-first').value,
    status: el.querySelector('.scan-guess .msg') && el.querySelector('.scan-guess .msg').dataset.status,
    parties: Object.fromEntries([...el.querySelectorAll('.scan-sum li[data-p]')].filter(li => li.dataset.p).map(li => [li.dataset.p,
      { party: li.dataset.party === '1', cands: li.dataset.cands ? li.dataset.cands.split(',').map(Number) : [] }])),
    boxes: Object.fromEntries([...el.querySelectorAll('.scan-sum li[data-p]')].filter(li => li.dataset.p).map(li => [li.dataset.p,
      { n: +li.dataset.boxes, repaired: /Doplněno|Vynecháno|Nalezeno/.test(li.textContent) }]))
  })));
}
function expectPage(p, label) {
  assert.equal(p.first, '21', `${label}: strana v levém sloupci`);
  assert.equal(p.status, 'sure', `${label}: odhad stran`);
  assert.deepEqual(Object.keys(p.parties).sort(), ['21', '22', '23', '24'], `${label}: strany`);
  for (const [n, e] of Object.entries(EXPECT)) assert.deepEqual(p.parties[n], e, `${label}: strana ${n}`);
}

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
PHOTOS.forEach((f, i) => test(`fotka ${i + 1} samotná`, async page => {
  const [p] = await evaluate(page, [f]);
  expectPage(p, `fotka ${i + 1}`);
}));
// the column frames (scanFrames) supply the boxes the box detector misses: every box is found, none
// has to be filled in or dropped by the repairs
test('každá fotka: všechna políčka nalezena bez oprav', async page => {
  const pages = await evaluate(page, PHOTOS);
  pages.forEach((p, i) => {
    for (const [n, k] of Object.entries({ 21: 14, 22: 65, 23: 41, 24: 65 }))
      assert.deepEqual(p.boxes[n], { n: k, repaired: false }, `fotka ${i + 1}, strana ${n}: políčka`);
  });
});
test('všechny čtyři fotky najednou, Použít na lístek', async page => {
  const pages = await evaluate(page, PHOTOS);
  assert.equal(pages.length, 4);
  pages.forEach((p, i) => expectPage(p, `fotka ${i + 1}`));
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
