"""Copies ballot.py verbatim into index.html (<script type="text/plain" id="ballot-py">), where the app
runs it under Pyodide. Run after every change of ballot.py: python3 tools/embed-ballot.py"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OPEN = '<script type="text/plain" id="ballot-py">\n'
src = (ROOT / "ballot.py").read_text(encoding="utf-8")
if "</script" in src.lower():
    raise SystemExit("ballot.py contains </script – it cannot be embedded in a script tag")
html = (ROOT / "index.html").read_text(encoding="utf-8")
start = html.index(OPEN) + len(OPEN)
end = html.index("</script>", start)
(ROOT / "index.html").write_text(html[:start] + src + html[end:], encoding="utf-8")
print(f"ballot.py ({len(src)} bytes) embedded in index.html")
