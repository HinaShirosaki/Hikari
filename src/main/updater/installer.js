'use strict';

const nodeFs = require('node:fs');
const path = require('node:path');

function resolveNpxInvocation(nodeBinary, platform) {
  const paths = platform === 'win32' ? path.win32 : path.posix;
  const nodeDir = paths.dirname(nodeBinary);
  if (platform === 'win32') {
    // npx.cmd needs a shell; npm's JS entrypoint sits next to node.exe.
    return { command: nodeBinary, args: [paths.join(nodeDir, 'node_modules', 'npm', 'bin', 'npx-cli.js')] };
  }
  return { command: paths.join(nodeDir, 'npx'), args: [] };
}

// What bin/dist.js leaves in <out>/Hikari-<platform>-<arch>/: the app bundle
// itself on macOS (forge package); on Windows the Squirrel setup and, for
// portable copies, the packaged app folder.
const BUILD_TARGETS = {
  darwin: 'Hikari.app',
  win32: 'HikariSetup.exe'
};
const PORTABLE_WIN32_TARGET = path.join('Hikari', 'Hikari.exe');

function findBuild(outDir, platform, fs = nodeFs, target = BUILD_TARGETS[platform]) {
  if (!target) {
    return '';
  }
  let entries = [];
  try {
    entries = fs.readdirSync(outDir).map(String);
  } catch {
    entries = [];
  }
  const match = entries.find((entry) => (
    entry.startsWith(`Hikari-${platform}-`) && fs.existsSync(path.join(outDir, entry, target))
  ));
  return match ? path.join(outDir, match, target) : '';
}

// Windows locks a running app's files, so a portable copy is swapped by this
// helper after Hikari exits: park the old folder beside it, copy the new one in
// (copying works across drives), start it, drop the parked copy. On failure the
// old folder is put back and started.
const PORTABLE_SWAP_SCRIPT = `param([int]$HikariPid, [string]$App, [string]$New)
$log = Join-Path (Split-Path $New) 'swap-portable.log'
function Log($m) { "$(Get-Date -Format o) $m" | Out-File -Append -Encoding utf8 $log }
Wait-Process -Id $HikariPid -ErrorAction SilentlyContinue
$parked = "$App.previous"
Remove-Item -Recurse -Force $parked -ErrorAction SilentlyContinue
# Helper processes can hold the old files for a moment after the main one exits.
for ($i = 0; $i -lt 60 -and (Test-Path $App); $i++) {
  try { Rename-Item $App (Split-Path $parked -Leaf) -ErrorAction Stop } catch { Start-Sleep -Milliseconds 500 }
}
if (Test-Path $App) { Log 'could not move the old app aside'; Start-Process (Join-Path $App 'Hikari.exe'); exit 1 }
try {
  Copy-Item $New $App -Recurse -ErrorAction Stop
  Remove-Item -Recurse -Force $parked -ErrorAction SilentlyContinue
  Log "updated $App"
} catch {
  Log "copy failed: $_"
  Remove-Item -Recurse -Force $App -ErrorAction SilentlyContinue
  Rename-Item $parked (Split-Path $App -Leaf)
}
Start-Process (Join-Path $App 'Hikari.exe')
`;

module.exports = { PORTABLE_SWAP_SCRIPT, PORTABLE_WIN32_TARGET, findBuild, resolveNpxInvocation };
