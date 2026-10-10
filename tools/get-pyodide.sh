#!/bin/sh
# Downloads the parts of Pyodide the app loads for "Vyfotit lístek" (ballot.py runs under Pyodide)
# into tests/.pyodide/, so that the tests can serve them instead of cdn.jsdelivr.net.
# Usage: sh tools/get-pyodide.sh [tarball]   (a downloaded pyodide-0.26.4.tar.bz2 can be passed)
set -e
VER=0.26.4
DIR="$(cd "$(dirname "$0")/.." && pwd)/tests/.pyodide"
FILES="pyodide.js pyodide.asm.js pyodide.asm.wasm python_stdlib.zip pyodide-lock.json
numpy-1.26.4-cp312-cp312-pyodide_2024_0_wasm32.whl opencv_python-4.9.0.80-cp312-cp312-pyodide_2024_0_wasm32.whl"
TAR="$1"
if [ -z "$TAR" ]; then
  TAR="$(mktemp -d)/pyodide-$VER.tar.bz2"
  # the release is ~300 MB: resume when the transfer is cut off
  for i in 1 2 3 4 5 6 7 8; do
    curl -sSL -C - -o "$TAR" "https://github.com/pyodide/pyodide/releases/download/$VER/pyodide-$VER.tar.bz2" && break
    sleep $((i * 2))
  done
fi
mkdir -p "$DIR"
tar xjf "$TAR" -C "$DIR" --strip-components=1 $(for f in $FILES; do printf 'pyodide/%s ' "$f"; done)
ls -la "$DIR"
