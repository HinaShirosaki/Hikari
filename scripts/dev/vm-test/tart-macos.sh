#!/bin/sh
# Runs app-only-update-e2e.mjs in a fresh macOS VM with tart (Apple Silicon Mac).
#   scripts/dev/vm-test/tart-macos.sh [old VM to delete ...]
# Deletes the VMs named on the command line and any earlier hikari-e2e-macos,
# clones a fresh Cirrus Labs base image (it has the tart guest agent, Homebrew
# and an auto-login desktop), runs the check in it and deletes the test VM
# afterwards (KEEP_VM=1 keeps it). Settings: VM, IMAGE, BRANCH, REPO.
set -eu
VM=${VM:-hikari-e2e-macos}
IMAGE=${IMAGE:-ghcr.io/cirruslabs/macos-tahoe-base:latest}
BRANCH=${BRANCH:-feat/app-only-updates}
REPO=${REPO:-https://github.com/HinaShirosaki/Hikari.git}

for old in "$@" "$VM"; do
  if tart list --source local --quiet | grep -qx "$old"; then
    echo "Deleting VM $old"
    tart stop "$old" >/dev/null 2>&1 || true
    tart delete "$old"
  fi
done

echo "Cloning $IMAGE as $VM"
tart clone "$IMAGE" "$VM"
tart run "$VM" --no-graphics >/dev/null 2>&1 &
cleanup() {
  tart stop "$VM" >/dev/null 2>&1 || true
  if [ "${KEEP_VM:-0}" != 1 ]; then tart delete "$VM"; fi
}
trap cleanup EXIT

echo "Waiting for the VM"
tries=0
until tart exec "$VM" true >/dev/null 2>&1; do
  tries=$((tries + 1))
  if [ "$tries" -ge 150 ]; then echo "The VM did not come up in 5 minutes"; exit 1; fi
  sleep 2
done

# A login shell, so Homebrew is on PATH.
tart exec "$VM" /bin/zsh -lc "
  set -e
  command -v node >/dev/null || brew install node
  command -v git >/dev/null || brew install git
  rm -rf ~/Hikari
  git clone --depth 1 --branch '$BRANCH' '$REPO' ~/Hikari
  cd ~/Hikari
  node scripts/dev/vm-test/app-only-update-e2e.mjs --compare-full
"
