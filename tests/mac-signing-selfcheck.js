'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { resolveMacSigningOptions } = require('../bin/mac-signing');

const development = { hash: '1'.repeat(40), name: 'Apple Development: Local Developer (TESTTEAM01)' };
const distribution = { hash: '2'.repeat(40), name: 'Developer ID Application: Local Developer (TESTTEAM01)' };
const inventory = (...identities) => identities.map((identity, index) => `  ${index + 1}) ${identity.hash} "${identity.name}"`).join('\n');

test('macOS packaging prefers Developer ID over a development certificate and keeps timestamping', () => {
  const options = resolveMacSigningOptions({ env: {}, run: (command, args) => {
    assert.equal(command, 'security');
    assert.deepEqual(args, ['find-identity', '-v', '-p', 'codesigning']);
    return inventory(development, distribution);
  } });
  assert.equal(options.identity, distribution.hash);
  assert.equal(options.identityValidation, true);
  assert.deepEqual(options.optionsForFile(), { hardenedRuntime: true });
});

test('macOS local builds use an available development certificate instead of a build hash identity', () => {
  const options = resolveMacSigningOptions({ env: {}, run: () => inventory(development) });
  assert.equal(options.identity, development.hash);
  assert.equal(options.identityValidation, true);
  assert.deepEqual(options.optionsForFile(), { hardenedRuntime: true, timestamp: 'none' });
});

test('an explicitly pinned signing certificate is honored and a missing certificate fails', () => {
  for (const requested of [development.name, development.hash]) {
    assert.equal(resolveMacSigningOptions({
      env: { HIKARI_MAC_SIGN_IDENTITY: requested }, run: () => inventory(development, distribution)
    }).identity, development.hash);
  }
  assert.throws(() => resolveMacSigningOptions({
    env: { HIKARI_MAC_SIGN_IDENTITY: 'Missing certificate' }, run: () => inventory(development)
  }), /does not match a valid code-signing identity/);
});

test('certificate-free builds remain possible and report their Keychain limitation', () => {
  for (const requested of ['', '-']) {
    let warning = '';
    const options = resolveMacSigningOptions({
      env: { HIKARI_MAC_SIGN_IDENTITY: requested },
      run: () => { assert.equal(requested, ''); return '0 valid identities found'; },
      warn: (message) => { warning = message; }
    });
    assert.equal(options.identity, '-');
    assert.equal(options.identityValidation, false);
    assert.equal(options.optionsForFile().hardenedRuntime, false);
    assert.match(warning, /Rebuilt apps may ask for Keychain access again/);
  }
});

test('a Keychain inventory failure does not silently downgrade a build to ad hoc signing', () => {
  assert.throws(() => resolveMacSigningOptions({
    env: {}, run: () => { throw new Error('Keychain unavailable'); }
  }), /Keychain unavailable/);
});
