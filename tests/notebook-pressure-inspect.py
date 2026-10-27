"""Render every pressure-test PDF and validate its real text/image bounds.

Run with the bundled Python runtime and the output directory from the Electron
check. Poppler uses a local font cache, so no user font settings are changed.
"""
import json
import os
from pathlib import Path
import subprocess
import sys

import pdfplumber
from PIL import Image, ImageDraw


def inspect(folder):
    folder = Path(folder).resolve()
    render_dir = folder / "rendered"
    render_dir.mkdir(exist_ok=True)
    cache_dir = render_dir / "fontcache"
    cache_dir.mkdir(exist_ok=True)
    root = Path(__file__).resolve().parents[1]
    config = render_dir / "fonts.conf"
    config.write_text(
        '<?xml version="1.0"?><!DOCTYPE fontconfig SYSTEM "fonts.dtd"><fontconfig>'
        '<dir>/System/Library/Fonts/Supplemental</dir>'
        f'<dir>{root}/vendor/pdfjs/web/standard_fonts</dir>'
        f'<cachedir>{cache_dir}</cachedir></fontconfig>'
    )
    environment = {**os.environ, "FONTCONFIG_FILE": str(config)}
    results = []
    for pdf in sorted(folder.glob("*.pdf")):
        with pdfplumber.open(pdf) as document:
            counts = []
            for number, page in enumerate(document.pages, 1):
                chars = [char for char in page.chars if char["text"].strip()]
                outside = [char for char in chars if char["x0"] < 18 or char["x1"] > page.width - 18
                           or char["top"] < 10 or char["bottom"] > page.height - 10]
                assert not outside, f"{pdf.name}, page {number}: text outside the paper: {outside[:1]}"
                assert all(char["size"] >= 6.99 for char in chars), f"{pdf.name}: unreadably small text"
                for image in page.images:
                    assert image["x0"] >= 0 and image["x1"] <= page.width + 0.1, f"{pdf.name}: image outside paper width"
                    assert image["top"] >= 0 and image["bottom"] <= page.height, f"{pdf.name}: image outside paper height"
                assert len(chars) > 30, f"{pdf.name}, page {number}: unexpected blank page"
                counts.append(len(chars))
            results.append({"file": pdf.name, "pages": len(document.pages), "bytes": pdf.stat().st_size,
                            "characters_per_page": counts})
        for old_page in render_dir.glob(pdf.stem + "-*.png"):
            if old_page.stem.rsplit("-", 1)[-1].isdigit():
                old_page.unlink()
        subprocess.run(["pdftoppm", "-scale-to", "1300", "-png", str(pdf), str(render_dir / pdf.stem)],
                       env=environment, check=True, capture_output=True, timeout=60)
        pages = sorted(image for image in render_dir.glob(pdf.stem + "-*.png")
                       if image.stem.rsplit("-", 1)[-1].isdigit())
        columns = min(3, len(pages))
        sheet = Image.new("RGB", (440 * columns, 600 * ((len(pages) + columns - 1) // columns)), "#dddddd")
        draw = ImageDraw.Draw(sheet)
        for index, page_path in enumerate(pages):
            page_image = Image.open(page_path)
            page_image.thumbnail((420, 560))
            x, y = index % columns * 440, index // columns * 600
            sheet.paste(page_image, (x, y + 25))
            draw.text((x + 5, y + 5), page_path.name, fill="black")
        sheet.save(render_dir / (pdf.stem + "-contact.png"))
    (folder / "pdf-inspection.json").write_text(json.dumps(results, indent=2))
    print(json.dumps({"pdfs": len(results), "pages": sum(item["pages"] for item in results), "bounds": "passed"}))


if __name__ == "__main__":
    inspect(sys.argv[1])
