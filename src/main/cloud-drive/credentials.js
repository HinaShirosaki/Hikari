'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { writeFileAtomic, withFileLock } = require('../lib/shared-json-file');

function createCredentialStore({ directory, safeStorage }) {
  const filePath = path.join(directory, 'cloud-credentials.json');
  function available() {
    return safeStorage?.isEncryptionAvailable?.() === true
      && safeStorage?.getSelectedStorageBackend?.() !== 'basic_text';
  }
  async function read() {
    try { return JSON.parse(await fs.readFile(filePath, 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return {}; throw new Error('Could not read cloud credentials.'); }
  }
  async function get(provider) {
    const data = await read();
    if (!data[provider]) return null;
    if (!available()) throw new Error('Secure credential storage is unavailable.');
    try { return JSON.parse(safeStorage.decryptString(Buffer.from(data[provider], 'base64'))); }
    catch { throw new Error('Could not unlock cloud credentials. Please disconnect and sign in again.'); }
  }
  async function set(provider, credentials) {
    return withFileLock(filePath, async () => {
      const data = await read();
      if (credentials) {
        if (!available()) throw new Error('Secure credential storage is unavailable.');
        data[provider] = safeStorage.encryptString(JSON.stringify(credentials)).toString('base64');
      } else delete data[provider];
      await fs.mkdir(directory, { recursive: true, mode: 0o700 });
      await writeFileAtomic(fs, filePath, JSON.stringify(data));
      await fs.chmod(filePath, 0o600);
    });
  }
  return { available, get, set };
}

module.exports = { createCredentialStore };
