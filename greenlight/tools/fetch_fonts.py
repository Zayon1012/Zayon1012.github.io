"""Download the latin-subset woff2 files for Anton, Oswald and Inter from Google Fonts into fonts/.
Used by CI so binary font files never need to be committed by hand."""
import re, os, requests
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
FAMILIES = {"Anton-400.woff2": "Anton", "Oswald-var.woff2": "Oswald:wght@400..700", "Inter-var.woff2": "Inter:wght@400..800"}
os.makedirs("fonts", exist_ok=True)
for out, fam in FAMILIES.items():
    css = requests.get(f"https://fonts.googleapis.com/css2?family={fam}&display=swap", headers={"User-Agent": UA}, timeout=30).text
    blocks = re.findall(r"/\* ([\w-]+) \*/\s*@font-face\s*{([^}]*)}", css)
    url = next(re.search(r"url\((https://[^)]+\.woff2)\)", b).group(1) for name, b in blocks if name == "latin")
    data = requests.get(url, timeout=30).content
    open(os.path.join("fonts", out), "wb").write(data)
    print(out, len(data))
