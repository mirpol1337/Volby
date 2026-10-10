#!/usr/bin/env node
/* Runs "Vyfotit lístek" (ballot.py under Pyodide, as in the app) on photos and prints what the app reads.
   Usage: node tools/scan-photos.js photo1.jpg [photo2.jpg …]   (one batch, like the app; max 8)
   FIRST=<party no.> sets the left-column party of every photo (like the select in the app);
   OUT=<dir> also saves ballot.py's annotated photos (annotated-1.jpg, …); APP=<file> uses another copy of the app.
   Needs Pyodide in tests/.pyodide (sh tools/get-pyodide.sh). */
'use strict';
const fs = require('fs'), path = require('path');
let playwright;
try { playwright = require('/opt/node-tools/node_modules/playwright'); } catch { playwright = require('playwright'); }
const { routePyodide } = require('../tests/pyodide');
const APP = process.env.APP ? path.resolve(process.env.APP) : path.join(__dirname, '..', 'index.html');
const files = process.argv.slice(2);
if (!files.length) { console.error('Usage: node tools/scan-photos.js photo.jpg [photo.jpg …]'); process.exit(2); }

(async () => {
  const browser = await playwright.chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.route(/^https?:/, r => r.abort());
  await routePyodide(ctx);
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('file://' + APP);
  await page.click('#scanOpen');
  await page.setInputFiles('#scanGallery', files.map(f => ({ name: path.basename(f), mimeType: 'image/jpeg', buffer: fs.readFileSync(f) })));
  const t0 = Date.now();
  await page.click('#scanRun');
  await page.waitForFunction(() => document.getElementById('scanPanel')._scan, null, { timeout: 300000 });
  if (process.env.FIRST) for (let i = 0; i < files.length; i++) {
    await page.evaluate(() => { delete document.getElementById('scanPanel')._scan; });
    await page.selectOption(`#scanFirst${i}`, process.env.FIRST);
    await page.waitForFunction(() => document.getElementById('scanPanel')._scan, null, { timeout: 300000 });
  }
  const ms = Date.now() - t0;
  const pages = await page.$$eval('#scanPages .scan-page', els => els.map(el => ({
    title: el.querySelector('h3').innerText, error: el.querySelector('[data-error]') ? el.querySelector('[data-error]').innerText : '',
    sum: [...el.querySelectorAll('.scan-sum li')].map(li => li.innerText.replace(/\s+/g, ' ')),
    img: el.querySelector('.scan-view img') ? el.querySelector('.scan-view img').src : null
  })));
  for (const [i, p] of pages.entries()) {
    console.log(`\n${p.title} (${path.basename(files[i])})`);
    if (p.error) console.log(`  ${p.error}`);
    p.sum.forEach(l => console.log(`  - ${l}`));
    if (process.env.OUT && p.img) {
      fs.mkdirSync(process.env.OUT, { recursive: true });
      const b64 = await page.evaluate(async src => { const b = await (await fetch(src)).blob(); return new Promise(ok => { const r = new FileReader(); r.onload = () => ok(r.result.split(',')[1]); r.readAsDataURL(b); }); }, p.img);
      fs.writeFileSync(path.join(process.env.OUT, `annotated-${i + 1}.jpg`), Buffer.from(b64, 'base64'));
    }
  }
  console.log(`\n${await page.textContent('#scanMsg')}`);
  console.log(`${files.length} photo(s) evaluated in ${ms} ms (Pyodide load included)`);
  if (errors.length) console.log('Page errors: ' + errors.join('; '));
  await browser.close();
})();
