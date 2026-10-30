"""Prepare native 4K demo captures and responsive website assets.

Usage: python3 website/hikari-is-tools/prepare-screenshots.py <capture-directory> [product|agent|protein|figura] [feature ...]
The directory must contain the group's full-page JPEGs and capture-manifest.json from
the isolated capture workflow described in README.md (six Product scenes, five
Agent scenes, or one Protein Builder scene). Never upscale.
"""
import hashlib
import json
import re
import sys
from pathlib import Path
from urllib.parse import parse_qs, urlparse
from PIL import Image, ImageDraw, ImageFont

source = Path(sys.argv[1])
group = sys.argv[2] if len(sys.argv) > 2 else "product"
output = Path(__file__).resolve().parent.parent / "hikari-is" / "shots"
groups = {
    "product": [
        ("suggest", "experiments", "AI experiments"),
        ("clone", "cloning", "Cloning & primers"),
        ("calc", "calculations", "Bench calculations"),
        ("protocol", "protocols", "Protocol to notebook"),
        ("workflow", "workflows", "Workflows · Repeated processes"),
        ("samples", "samples", "Sample management"),
    ],
    "agent": [
        ("agent-protocols", "agent-protocols", "Generate & polish protocols"),
        ("agent-insights", "agent-insights", "Explain a selection"),
        ("agent-papers", "agent-papers", "Find & ask about papers"),
        ("agent-plot", "agent-plot", "Plot on request"),
        ("agent-review", "agent-review", "Review every draft"),
    ],
    "protein": [("protein-builder", "protein-builder", "Protein Builder · Protein and DNA")],
    "figura": [("plugins", "plugins", "Figura · Receptor signaling and response")],
}
scenes = groups[group]
features = set(sys.argv[3:])
if features - {feature for _, feature, _ in scenes}:
    raise ValueError(f"Unknown {group} features: {features}")
selected = [scene for scene in scenes if not features or scene[1] in features]
manifest = json.loads((source / "capture-manifest.json").read_text())
entries = {entry["name"]: entry for entry in manifest["scenes"]}
images = {}
for name, feature, label in scenes:
    entry = entries[name]
    query = parse_qs(urlparse(entry["url"]).query)
    if query.get("capture") != ["1"] or query.get("feature") != [feature]:
        raise ValueError(f"{name}: expected an isolated capture URL")
    if re.search(r"TestData3|CalB|pETDuet|SUMO", entry["auditText"], re.I):
        raise ValueError(f"{name}: a non-demo project name appeared")
    raw = Image.open(source / f"{name}.{'png' if group == 'figura' else 'jpg'}")
    if raw.width != 3840 or raw.height < 2400:
        raise ValueError(f"{name}: expected a native 3840px capture; got {raw.size}")
    # The fixed app occupies the top 2400 pixels. Remove only the blank space
    # below it; preserve the complete macOS title bar and workspace.
    images[name] = raw.crop((0, 0, 3840, 2400)).convert("RGB")

output.mkdir(exist_ok=True)
# One manifest covers every group: replace only this group's entries.
manifest_file = Path(__file__).resolve().parent / "shots-manifest.json"
report = json.loads(manifest_file.read_text()) if manifest_file.exists() else {
    "source": "Fictional Hikari browser demo fixtures", "logicalSize": [1280, 800], "renderScale": 3, "images": []}
names = {f"{name}.webp" for name, _, _ in selected}
report["images"] = [image for image in report["images"] if image["file"] not in names]
for name, feature, label in selected:
    image = images[name]
    path = output / f"{name}.webp"
    image.save(path, "WEBP", quality=96, method=6)
    for width in (1280, 1920):
        image.resize((width, width * 5 // 8), Image.Resampling.LANCZOS).save(
            output / f"{name}-{width}.webp", "WEBP", quality=96, method=6)
    report["images"].append({"file": path.name, "feature": feature, "size": list(image.size),
                             "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                             **({"logicalSize": manifest["logicalSize"], "renderScale": manifest["renderScale"]}
                                if "logicalSize" in manifest and manifest["logicalSize"] != report["logicalSize"] else {}),
                             **({"source": entries[name]["source"]} if "source" in entries[name] else {})})
    print(f"{path.name}: {image.width} × {image.height}, {path.stat().st_size:,} bytes")
manifest_file.write_text(json.dumps(report, indent=2) + "\n")

if group in ("protein", "figura"):
    sys.exit(0)

rows = (len(scenes) + 1) // 2
sheet = Image.new("RGB", (2016, 24 + rows * 666), "#0f0e0c")
draw = ImageDraw.Draw(sheet)
try:
    font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial.ttf", 24)
except OSError:
    font = ImageFont.load_default()
for i, (name, feature, label) in enumerate(scenes):
    x, y = 24 + (i % 2) * 984, 24 + (i // 2) * 666
    draw.text((x, y), label, font=font, fill="#eee8dc")
    sheet.paste(images[name].resize((960, 600), Image.Resampling.LANCZOS), (x, y + 36))
sheet.save(output / ("overview.jpg" if group == "product" else f"{group}-overview.jpg"), quality=95)
