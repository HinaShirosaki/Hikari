// Large projects live in plugin files, outside the small record index. Two
// rotating slots bound disk use; the host atomically commits the manifest last.
const ROOT = 'Workspace';
const CHUNK_BYTES = 6_000_000;
const MAX_BYTES = 180_000_000;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const missing = error => /not found|ENOENT/i.test(String(error?.message || error));
const digest = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
  .map(value => value.toString(16).padStart(2, '0')).join('');
function encode(bytes) {
  const parts = [];
  for (let i = 0; i < bytes.length; i += 0x8000) parts.push(String.fromCharCode(...bytes.subarray(i, i + 0x8000)));
  return btoa(parts.join(''));
}
const decode = value => Uint8Array.from(atob(value), character => character.charCodeAt(0));

export function createGelWorkspaceStore({ hikari, isConfigured }) {
  let accepted = null;
  let closed = false;
  const read = async path => decode((await hikari.call('files.read', { path })).dataBase64);
  const write = async (path, bytes) => {
    if (closed) throw new Error('The Gel storage folder changed.');
    return hikari.call('files.write', { path, dataBase64: encode(bytes) });
  };
  async function load() {
    accepted = null;
    if (!isConfigured()) return [];
    const candidates = [], errors = [];
    for (const name of ['current', 'previous']) {
      let found = false;
      try {
        const manifestBytes = await read(`${ROOT}/${name}.json`); found = true;
        const manifest = JSON.parse(decoder.decode(manifestBytes));
        if (manifest?.version !== 1 || ![0, 1].includes(manifest.slot) || !Array.isArray(manifest.chunks) || manifest.chunks.length > 30
          || !Number.isSafeInteger(manifest.bytes) || manifest.bytes < 1 || manifest.bytes > MAX_BYTES
          || manifest.chunks.some(hash => !/^[a-f0-9]{64}$/.test(hash))) throw new Error('Invalid workspace manifest.');
        const bytes = new Uint8Array(manifest.bytes);
        let offset = 0;
        for (const [index, hash] of manifest.chunks.entries()) {
          const chunk = await read(`${ROOT}/slots/${manifest.slot}/${index}.bin`);
          if (chunk.length > CHUNK_BYTES || offset + chunk.length > bytes.length || await digest(chunk) !== hash) {
            throw new Error('Incomplete workspace data.');
          }
          bytes.set(chunk, offset); offset += chunk.length;
        }
        if (offset !== bytes.length) throw new Error('Incomplete workspace data.');
        candidates.push({ content: decoder.decode(bytes), previous: name === 'previous', accept() {
          accepted = manifest;
        } });
      } catch (error) { if (found || !missing(error)) errors.push(error); }
    }
    if (!candidates.length && errors.length) throw errors[0];
    return candidates;
  }
  async function save(content) {
    if (!isConfigured()) throw new Error('Choose a storage folder in Hikari Settings before saving the workspace.');
    const bytes = encoder.encode(content);
    if (!bytes.length || bytes.length > MAX_BYTES) throw new Error('The Gel workspace is too large to save.');
    const chunks = [];
    for (let offset = 0; offset < bytes.length; offset += CHUNK_BYTES) chunks.push(await digest(bytes.subarray(offset, offset + CHUNK_BYTES)));
    if (accepted?.bytes === bytes.length && JSON.stringify(accepted.chunks) === JSON.stringify(chunks)) return;
    const slot = accepted?.slot === 0 ? 1 : 0;
    for (let index = 0; index < chunks.length; index++) {
      await write(`${ROOT}/slots/${slot}/${index}.bin`, bytes.subarray(index * CHUNK_BYTES, (index + 1) * CHUNK_BYTES));
    }
    const manifest = { version: 1, slot, bytes: bytes.length, chunks };
    if (accepted) await write(`${ROOT}/previous.json`, encoder.encode(JSON.stringify(accepted)));
    await write(`${ROOT}/current.json`, encoder.encode(JSON.stringify(manifest)));
    accepted = manifest;
  }
  return { load, save, dispose() { closed = true; } };
}
