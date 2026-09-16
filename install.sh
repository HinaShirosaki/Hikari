#!/bin/sh
# Hikari installer for macOS / Linux:
#   curl -fsSL https://cdn.jsdelivr.net/npm/@hinashirosaki/hikari/install.sh | bash
# Builds the native Hikari app on this machine and writes the installer to ./hikari-out/make/.
# Without Node.js 20+ on PATH it downloads a private copy to ~/.hikari/node; nothing system-wide changes.
set -e

NODE_DIST="https://nodejs.org/dist/latest-v24.x"
HIKARI_NODE="${HIKARI_NODE_DIR:-$HOME/.hikari/node}"

have_node() {
  command -v node >/dev/null 2>&1 && [ "$(node -p 'process.versions.node.split(".")[0]')" -ge 20 ]
}

if ! have_node; then
  if [ ! -x "$HIKARI_NODE/bin/node" ]; then
    case "$(uname -s)" in
      Darwin) os=darwin ;;
      Linux) os=linux ;;
      *) echo "Unsupported OS: $(uname -s)" >&2; exit 1 ;;
    esac
    case "$(uname -m)" in
      x86_64 | amd64) arch=x64 ;;
      arm64 | aarch64) arch=arm64 ;;
      *) echo "Unsupported CPU: $(uname -m)" >&2; exit 1 ;;
    esac
    sums="$(curl -fsSL "$NODE_DIST/SHASUMS256.txt")"
    tarball="$(printf '%s\n' "$sums" | grep -o "node-v[0-9.]*-$os-$arch\.tar\.gz" | head -1)"
    [ -n "$tarball" ] || { echo "No Node.js build for $os-$arch at $NODE_DIST" >&2; exit 1; }
    echo "Node.js 20+ not found; downloading $tarball to $HIKARI_NODE"
    tmp="$(mktemp -d)"
    curl -fsSL "$NODE_DIST/$tarball" -o "$tmp/$tarball"
    if command -v sha256sum >/dev/null 2>&1; then sha=sha256sum; else sha="shasum -a 256"; fi
    (cd "$tmp" && printf '%s\n' "$sums" | grep " $tarball\$" | $sha -c - >/dev/null)
    mkdir -p "$HIKARI_NODE"
    tar -xzf "$tmp/$tarball" -C "$HIKARI_NODE" --strip-components=1
    rm -rf "$tmp"
  fi
  PATH="$HIKARI_NODE/bin:$PATH"
  export PATH
fi

# --yes: stdin is the piped script, so npx must not prompt.
npx --yes @hinashirosaki/hikari
