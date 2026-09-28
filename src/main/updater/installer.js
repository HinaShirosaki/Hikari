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

const INSTALLER_PATTERNS = {
  darwin: /\.zip$/iu,
  win32: /Setup\.exe$/iu,
  linux: /\.(?:deb|rpm)$/iu
};

function findInstaller(makeDir, platform, fs = nodeFs) {
  const pattern = INSTALLER_PATTERNS[platform];
  let entries = [];
  try {
    entries = fs.readdirSync(makeDir, { recursive: true });
  } catch {
    entries = [];
  }
  const match = entries.map(String).find((entry) => pattern?.test(entry));
  return match ? path.join(makeDir, match) : '';
}

module.exports = { findInstaller, resolveNpxInvocation };
