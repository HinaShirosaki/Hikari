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

module.exports = { PORTABLE_WIN32_TARGET, findBuild, resolveNpxInvocation };
