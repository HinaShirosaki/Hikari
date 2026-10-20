#!/bin/sh
# curl -fsSL https://cdn.jsdelivr.net/npm/@hinashirosaki/hikari/install.sh | bash
# Prefer a verified release archive; HIKARI_BUILD_FROM_SOURCE=1 forces a local build.
set -eu

[ "$(uname -s)" = Darwin ] || { echo "Hikari supports macOS and Windows only." >&2; exit 1; }
case "$(uname -m)" in
  x86_64) arch=x64 ;;
  arm64) arch=arm64 ;;
  *) echo "Unsupported CPU: $(uname -m)" >&2; exit 1 ;;
esac

NODE_DIST="https://nodejs.org/dist/latest-v24.x"
HIKARI_NODE="${HIKARI_NODE_DIR:-$HOME/.hikari/node}"
HIKARI_NODE="${HIKARI_NODE%/}"
[ -n "$HIKARI_NODE" ] || { echo 'HIKARI_NODE_DIR must name a cache folder.' >&2; exit 1; }
output="${HIKARI_OUT_DIR:-$PWD/hikari-out}"
tmp=''
node_tmp=''
node_lock=''
cleanup() {
  status=$?
  [ -z "$tmp" ] || rm -rf "$tmp"
  [ -z "$node_tmp" ] || rm -rf "$node_tmp"
  [ -z "$node_lock" ] || rmdir "$node_lock"
  trap - 0
  exit "$status"
}
trap cleanup 0
trap 'exit 130' INT
trap 'exit 143' TERM

download() {
  curl -fSL --retry 3 --connect-timeout 15 --max-time 300 "$1" -o "$2"
}

tmp="$(mktemp -d)"
version="${HIKARI_VERSION:-}"
if [ -z "$version" ]; then
  download 'https://registry.npmjs.org/-/package/@hinashirosaki%2fhikari/dist-tags' "$tmp/tags.json"
  version="$(sed -n 's/.*"latest"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$tmp/tags.json")"
fi
printf '%s\n' "$version" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+([-+][0-9A-Za-z.+-]+)?$' \
  || { echo 'Could not resolve a valid Hikari version.' >&2; exit 1; }

if [ "${HIKARI_BUILD_FROM_SOURCE:-0}" != 1 ]; then
  asset="Hikari-$version-darwin-$arch.zip"
  release="https://github.com/HinaShirosaki/Hikari/releases/download/v$version"
  echo "Checking for Hikari $version for macOS $arch..."
  if download "$release/$asset.sha256" "$tmp/checksum" && download "$release/$asset" "$tmp/$asset"; then
    expected="$(awk 'NR == 1 { print $1 }' "$tmp/checksum")"
    printf '%s\n' "$expected" | grep -Eq '^[0-9a-fA-F]{64}$' \
      || { echo 'Invalid Hikari archive checksum.' >&2; exit 1; }
    (cd "$tmp" && printf '%s  %s\n' "$expected" "$asset" | shasum -a 256 -c -)
    mkdir -p "$output"
    destination="$output/Hikari-darwin-$arch"
    [ ! -e "$destination" ] || { echo "$destination already exists. Choose another HIKARI_OUT_DIR." >&2; exit 1; }
    # Stage beside the destination so the completed bundle can be renamed atomically.
    node_tmp="$(mktemp -d "$output/.hikari-extract.XXXXXX")"
    ditto -x -k "$tmp/$asset" "$node_tmp"
    [ -f "$node_tmp/Hikari-darwin-$arch/Hikari.app/Contents/Info.plist" ] \
      || { echo 'Hikari archive is missing the app bundle.' >&2; exit 1; }
    mv "$node_tmp/Hikari-darwin-$arch" "$destination"
    echo "Hikari: $destination/Hikari.app"
    echo 'Move Hikari.app to Applications, then open it.'
    exit 0
  fi
  echo 'A prebuilt archive is unavailable; building Hikari locally.'
fi

have_node() {
  command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1 && command -v npx >/dev/null 2>&1 \
    && node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 20 ? 0 : 1)' \
    && npm --version >/dev/null 2>&1 && npx --version >/dev/null 2>&1
}
valid_runtime() {
  runtime="$1"
  [ -x "$runtime/bin/node" ] && [ -x "$runtime/bin/npm" ] && [ -x "$runtime/bin/npx" ] \
    && "$runtime/bin/node" -e "process.exit(Number(process.versions.node.split('.')[0]) >= 20 && process.platform === 'darwin' && process.arch === '$arch' ? 0 : 1)" \
    && "$runtime/bin/node" "$runtime/lib/node_modules/npm/bin/npm-cli.js" --version >/dev/null 2>&1 \
    && "$runtime/bin/node" "$runtime/lib/node_modules/npm/bin/npx-cli.js" --version >/dev/null 2>&1
}

if ! have_node; then
  if ! valid_runtime "$HIKARI_NODE"; then
    if [ -e "$HIKARI_NODE" ] || [ -L "$HIKARI_NODE" ]; then
      if [ ! -d "$HIKARI_NODE" ] || { [ ! -e "$HIKARI_NODE/bin/node" ] && [ ! -L "$HIKARI_NODE/bin/node" ] \
        && [ ! -d "$HIKARI_NODE/lib/node_modules/npm" ] && [ -n "$(ls -A "$HIKARI_NODE")" ]; }; then
        echo "$HIKARI_NODE contains unrelated files. Choose a dedicated HIKARI_NODE_DIR." >&2
        exit 1
      fi
    fi
    mkdir -p "$(dirname "$HIKARI_NODE")"
    lock_path="$HIKARI_NODE.install-lock"
    mkdir "$lock_path" 2>/dev/null || { echo "Another Node setup is using $lock_path. Retry after it finishes." >&2; exit 1; }
    node_lock="$lock_path"
    node_tmp="$(mktemp -d "$(dirname "$HIKARI_NODE")/.hikari-node.XXXXXX")"
    download "$NODE_DIST/SHASUMS256.txt" "$node_tmp/sums"
    tarball="$(awk -v arch="$arch" '$2 ~ ("^node-v[0-9.]+-darwin-" arch "\\.tar\\.gz$") { print $2; exit }' "$node_tmp/sums")"
    [ -n "$tarball" ] || { echo "No Node.js build for darwin-$arch at $NODE_DIST" >&2; exit 1; }
    # Use the exact version directory selected by the checksum file, even if latest moves.
    node_version="${tarball%-darwin-*}"
    echo "Downloading $tarball to $HIKARI_NODE"
    download "https://nodejs.org/dist/${node_version#node-}/$tarball" "$node_tmp/$tarball"
    (cd "$node_tmp" && awk -v file="$tarball" '$2 == file' sums | shasum -a 256 -c -)
    mkdir "$node_tmp/runtime"
    tar -xzf "$node_tmp/$tarball" -C "$node_tmp/runtime" --strip-components=1
    valid_runtime "$node_tmp/runtime" || { echo 'Downloaded Node.js runtime failed validation.' >&2; exit 1; }
    if [ -e "$HIKARI_NODE" ]; then mv "$HIKARI_NODE" "$node_tmp/previous"; fi
    if ! mv "$node_tmp/runtime" "$HIKARI_NODE"; then
      [ ! -e "$node_tmp/previous" ] || mv "$node_tmp/previous" "$HIKARI_NODE"
      exit 1
    fi
    rm -rf "$node_tmp"
    node_tmp=''
    rmdir "$node_lock"
    node_lock=''
  fi
  PATH="$HIKARI_NODE/bin:$PATH"
  export PATH
fi

# A local package spec is useful for testing this bootstrap before publishing.
# Explicit version avoids accidentally running a different locally installed Hikari.
npx --yes "${HIKARI_PACKAGE_SPEC:-@hinashirosaki/hikari@$version}"
