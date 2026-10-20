#!/usr/bin/env node
// `npx @hinashirosaki/hikari` — builds the native Hikari installer on this machine.
// Build in a private workspace with the lock shipped by npm's prepack hook.
const path = require('node:path');
const { buildFromSource } = require('./source-build');

if (!['darwin', 'win32'].includes(process.platform)) {
  console.error('Hikari supports macOS and Windows only.');
  process.exit(1);
}

let output;
try {
  output = buildFromSource({ root: path.join(__dirname, '..') });
} catch (error) {
  console.error(`Hikari build failed: ${error.message}`);
  process.exit(1);
}

if (process.platform === 'darwin') {
  console.log(`\nHikari: ${path.join(output, `Hikari-darwin-${process.arch}`, 'Hikari.app')}`);
} else {
  const out = path.join(output, `Hikari-win32-${process.arch}`);
  console.log(`\nHikari (portable, runs from any folder): ${path.join(out, 'Hikari', 'Hikari.exe')}`);
  console.log(`Hikari installer: ${path.join(out, 'HikariSetup.exe')}`);
}
