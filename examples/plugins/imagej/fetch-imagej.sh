#!/bin/sh
# Downloads the compiled ImageJ into ./ij153 so this plugin can serve it
# locally. Run once before installing the plugin.
#
# The payload (~59 MB unpacked) is ImageJ's own code, AOT-compiled for CheerpJ
# and published by the ImageJ.JS project. It is not vendored into this repo
# because of its size; see README.md for what still loads from the network.
set -e

cd "$(dirname "$0")"

if [ -d ij153 ]; then
  echo "ij153/ already present — delete it first to re-download."
  exit 0
fi

URL="https://github.com/imjoy-team/ImageJA.JS/releases/download/1.53m3/imagej-js-dist.tgz"

echo "Downloading ImageJ from $URL"
curl -fL -o imagej-js-dist.tgz "$URL"

echo "Extracting…"
tar -xzf imagej-js-dist.tgz
mv imagej-js-dist/ij153 ./ij153
rm -rf imagej-js-dist imagej-js-dist.tgz

echo "Done. ImageJ is in ./ij153 — now add this folder in Settings > Plugins."
