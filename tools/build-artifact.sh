#!/bin/sh
# Builds the claude.ai artifact into <outdir>: scitani-praha.html (the page without the standalone-only
# wrapper lines) and pyodide/ – the Pyodide files the page loads to run ballot.py. The artifact sandbox
# lets the page fetch only files published with it, max 15 MB each, so the OpenCV package is split into
# parts listed in pyodide/parts.json (the page joins them). Needs tests/.pyodide (sh tools/get-pyodide.sh).
# Usage: sh tools/build-artifact.sh <outdir>
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:?usage: build-artifact.sh <outdir>}"
PYO="$ROOT/tests/.pyodide"
[ -f "$PYO/pyodide.js" ] || { echo "Pyodide missing in $PYO – run: sh tools/get-pyodide.sh" >&2; exit 1; }
mkdir -p "$OUT/pyodide"
grep -v '<!--wrap-->' "$ROOT/index.html" | grep -v 'id="dlCsv"' > "$OUT/scitani-praha.html"
for f in pyodide.js pyodide.asm.js pyodide.asm.wasm python_stdlib.zip pyodide-lock.json numpy-1.26.4-cp312-cp312-pyodide_2024_0_wasm32.whl; do
  cp "$PYO/$f" "$OUT/pyodide/$f"
done
CV=opencv_python-4.9.0.80-cp312-cp312-pyodide_2024_0_wasm32.whl
rm -f "$OUT/pyodide/$CV".part*
split -b 12m -d -a 1 "$PYO/$CV" "$OUT/pyodide/$CV.part"
PARTS=$(cd "$OUT/pyodide" && ls "$CV".part* | sed 's/.*/"&"/' | paste -sd, -)
printf '{ "%s": [%s] }\n' "$CV" "$PARTS" > "$OUT/pyodide/parts.json"
ls -la "$OUT" "$OUT/pyodide"
