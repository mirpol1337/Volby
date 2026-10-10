#!/usr/bin/env node
/* Runs "Vyfotit lístek" on photos and prints what the app reads – for checking new real photos.
   Usage: node tools/scan-photos.js photo1.jpg [photo2.jpg …]   (one batch, like the app; max 8)
   OUT=<dir> also saves the preview overlays (overlay-1.png, …); APP=<file> uses another copy of the app. */
'use strict';
const fs = require('fs'), path = require('path');
let playwright;
try { playwright = require('/opt/node-tools/node_modules/playwright'); } catch { playwright = require('playwright'); }
const APP = process.env.APP ? path.resolve(process.env.APP) : path.join(__dirname, '..', 'index.html');
const files = process.argv.slice(2);
if (!files.length) { console.error('Usage: node tools/scan-photos.js photo.jpg [photo.jpg …]'); process.exit(2); }

(async () => {
  const browser = await playwright.chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.route(/^https?:/, r => r.abort());
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('file://' + APP);
  await page.click('#scanOpen');
  await page.setInputFiles('#scanGallery', files.map(f => ({ name: path.basename(f), mimeType: 'image/jpeg', buffer: fs.readFileSync(f) })));
  const t0 = Date.now();
  await page.click('#scanRun');
  await page.waitForFunction(() => document.getElementById('scanPanel')._scan, null, { timeout: 120000 });
  const ms = Date.now() - t0;
  const pages = await page.evaluate(() => {
    const res = document.getElementById('scanPanel')._scan;
    return [...document.querySelectorAll('#scanPages .scan-page')].map((el, i) => ({
      first: el.querySelector('.scan-first') && el.querySelector('.scan-first').value,
      guess: el.querySelector('.scan-guess') ? el.querySelector('.scan-guess').innerText.replace(/\s+/g, ' ') : el.innerText.replace(/\s+/g, ' '),
      sum: el.querySelector('.scan-sum') ? [...el.querySelectorAll('.scan-sum li')].map(li => li.innerText.replace(/\s+/g, ' ')) : [],
      cols: res[i] ? res[i].cols.map(c => `x=${Math.round(c.x)} ${c.frame ? `frame (+${c.framed}${c.framed ? " at " + c.cands.map((b, j) => b.framed ? j + 1 : 0).filter(Boolean) : ""})` : "no frame"}, ${c.head ? 'party box' + (c.head.found ? ' (searched)' : c.head.joined ? ' (joined)' : '') : 'no party box'} ${c.cands.length} boxes`) : [],
      png: el.querySelector('canvas') ? el.querySelector('canvas').toDataURL('image/png') : null
    }));
  });
  pages.forEach((p, i) => {
    console.log(`\nPhoto ${i + 1} (${path.basename(files[i])}) – left column party ${p.first}`);
    console.log(`  ${p.guess}`);
    console.log(`  detected columns: ${p.cols.join(' | ')}`);
    p.sum.forEach(l => console.log(`  - ${l}`));
    if (process.env.OUT && p.png) fs.writeFileSync(path.join(process.env.OUT, `overlay-${i + 1}.png`), Buffer.from(p.png.split(',')[1], 'base64'));
  });
  console.log(`\n${files.length} photo(s) evaluated in ${ms} ms${errors.length ? '\nERRORS: ' + errors.join('; ') : ''}`);
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})();
