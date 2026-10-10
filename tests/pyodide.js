/* Serves Pyodide (which runs ballot.py in the app) from tests/.pyodide instead of cdn.jsdelivr.net.
   Get the files once with: sh tools/get-pyodide.sh
   Register after any route that blocks the network (Playwright runs the last registered route first). */
'use strict';
const fs = require('fs'), path = require('path');
const DIR = process.env.PYODIDE_DIR || path.join(__dirname, '.pyodide');
const TYPES = { '.js': 'text/javascript', '.wasm': 'application/wasm', '.json': 'application/json' };
async function routePyodide(ctx) {
  if (!fs.existsSync(path.join(DIR, 'pyodide.js'))) throw new Error(`Pyodide není v ${DIR} – spusťte: sh tools/get-pyodide.sh`);
  await ctx.route(/^https:\/\/cdn\.jsdelivr\.net\/pyodide\/v0\.26\.4\/full\/[^/?]+$/, r => {
    const f = path.join(DIR, new URL(r.request().url()).pathname.split('/').pop());
    if (!fs.existsSync(f)) return r.fulfill({ status: 404, body: 'not found' });
    r.fulfill({ status: 200, body: fs.readFileSync(f), contentType: TYPES[path.extname(f)] || 'application/octet-stream', headers: { 'Access-Control-Allow-Origin': '*' } });
  });
}
module.exports = { routePyodide };
