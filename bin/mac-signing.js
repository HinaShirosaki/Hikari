'use strict';

const { execFileSync } = require('node:child_process');

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
    optionsForFile: () => ({
      hardenedRuntime: Boolean(identity),
      // Developer ID releases use Apple's timestamp service. Local development
      // and ad hoc builds can be signed offline.
      ...(distribution ? {} : { timestamp: 'none' })
    })
  };
}

module.exports = { resolveMacSigningOptions };
