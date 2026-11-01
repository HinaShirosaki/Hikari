'use strict';

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');

// Thin Mach-O in either byte order, plus fat (universal) binaries.
const MACH_O_MAGIC = new Set(['feedface', 'feedfacf', 'cefaedfe', 'cffaedfe', 'cafebabe', 'bebafeca']);

// osx-sign runs codesign once per file its binary sniff flags, including every
// PNG, .pak and PDF.js cmap (~1000 calls, ~40 s). The bundle signature already
// seals those resources, so only Mach-O files and bundles need their own pass.
function isDataFile(filePath) {
  let fd;
  try {
    if (!fs.statSync(filePath).isFile()) return false;
    fd = fs.openSync(filePath, 'r');
    const magic = Buffer.alloc(4);
    fs.readSync(fd, magic, 0, 4, 0);
    return !MACH_O_MAGIC.has(magic.toString('hex'));
  } catch {
    return false;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function resolveMacSigningOptions({ env = process.env, run = execFileSync, warn = console.warn } = {}) {
  const requested = String(env.HIKARI_MAC_SIGN_IDENTITY || '').trim();
  let identity = null;
  if (requested !== '-') {
    // Inspect only identity metadata; private keys remain in the Keychain.
    const output = run('security', ['find-identity', '-v', '-p', 'codesigning'], { encoding: 'utf8' });
    const identities = [...output.matchAll(/\)\s+([A-Fa-f0-9]{40})\s+"([^"]+)"/g)]
      .map((match) => ({ hash: match[1], name: match[2] }));
    if (requested) {
      identity = identities.find((candidate) => candidate.name === requested
        || candidate.hash.toLowerCase() === requested.toLowerCase());
      if (!identity) throw new Error('HIKARI_MAC_SIGN_IDENTITY does not match a valid code-signing identity in the Keychain.');
    } else {
      // Prefer a distribution identity, then a persistent local development
      // identity. Never replace certificate checks with an identifier-only DR.
      for (const prefix of ['Developer ID Application:', 'Apple Development:', 'Mac Developer:']) {
        identity = identities.filter((candidate) => candidate.name.startsWith(prefix))
          .sort((left, right) => left.hash.localeCompare(right.hash))[0];
        if (identity) break;
      }
    }
  }
  if (!identity) {
    warn('Hikari will use ad hoc signing. Rebuilt apps may ask for Keychain access again. '
      + 'Install a signing certificate or set HIKARI_MAC_SIGN_IDENTITY to its full name or SHA-1 hash.');
  }
  const distribution = identity?.name.startsWith('Developer ID Application:');
  return {
    identity: identity?.hash || '-',
    identityValidation: Boolean(identity),
    preAutoEntitlements: false,
    preEmbedProvisioningProfile: false,
    ignore: isDataFile,
    optionsForFile: () => ({
      hardenedRuntime: Boolean(identity),
      // Developer ID releases use Apple's timestamp service. Local development
      // and ad hoc builds can be signed offline.
      ...(distribution ? {} : { timestamp: 'none' })
    })
  };
}

module.exports = { resolveMacSigningOptions, isDataFile };
