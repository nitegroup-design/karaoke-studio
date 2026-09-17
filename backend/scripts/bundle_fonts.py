"""Refresh bundled video fonts; build-time dependency: fonttools==4.61.1."""
from pathlib import Path
from urllib.request import urlopen, Request
from io import BytesIO
import json
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

DEST = Path(__file__).resolve().parents[1] / "assets" / "fonts"
FAMILIES = {
    "bevietnampro": "BeVietnamPro-Bold.ttf",
    "montserrat": "Montserrat-Bold.ttf",
    "playfairdisplay": "PlayfairDisplay-Bold.ttf",
    "lexend": "Lexend-Bold.ttf",
    "oswald": "Oswald-Bold.ttf",
    "roboto": "Roboto-Bold.ttf",
}

def fetch(url):
    with urlopen(Request(url, headers={"User-Agent": "Karaoke-Studio-font-bundler"}), timeout=60) as response:
        return response.read()

if __name__ == "__main__":
    DEST.mkdir(parents=True, exist_ok=True)
    provenance = {}
    for family, filename in FAMILIES.items():
        entries = json.loads(fetch(f"https://api.github.com/repos/google/fonts/contents/ofl/{family}"))
        source = next(e for e in entries if e["name"] == filename or (e["name"].endswith(".ttf") and "[" in e["name"] and "Italic" not in e["name"]))
        font = TTFont(BytesIO(fetch(source["download_url"])))
        if "fvar" in font:
            axes = {axis.axisTag: (700 if axis.axisTag == "wght" else axis.defaultValue) for axis in font["fvar"].axes}
            font = instantiateVariableFont(font, axes, inplace=True)
        font.save(DEST / filename)
        license_entry = next(e for e in entries if e["name"] == "OFL.txt")
        (DEST / f"{family}-OFL.txt").write_bytes(fetch(license_entry["download_url"]))
        provenance[filename] = {"url": source["download_url"], "git_blob": source["sha"], "weight": 700}
        print(filename)
    (DEST / "sources.json").write_text(json.dumps(provenance, indent=2), encoding="utf-8")
