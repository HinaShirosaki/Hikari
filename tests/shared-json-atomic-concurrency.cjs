'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { writeFileAtomic } = require('../src/main/lib/shared-json-file');

async function main() {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'hikari-atomic-writes-'));
  const target = path.join(folder, 'fixture.json');
  const originalNow = Date.now;
  try {
    const count = 12;
    const temporaryPaths = [];
    let writes = 0;
    let release;
    const barrier = new Promise(resolve => { release = resolve; });
    const io = {
      ...fs,
      async writeFile(file, ...args) {
        temporaryPaths.push(file);
        await fs.writeFile(file, ...args);
        if (++writes === count) release();
        await barrier;
      },
    };
    // Force the condition that caused missing-temp-file failures in the app.
    Date.now = () => 1790916227238;
    await Promise.all(Array.from({ length: count }, (_, writer) =>
      writeFileAtomic(io, target, JSON.stringify({ writer, payload: String(writer).repeat(1024) }))));
    assert.equal(new Set(temporaryPaths).size, count);
    const saved = JSON.parse(await fs.readFile(target, 'utf8'));
    assert.ok(saved.writer >= 0 && saved.writer < count);
    assert.equal(saved.payload, String(saved.writer).repeat(1024));
    assert.deepEqual(await fs.readdir(folder), ['fixture.json']);

    // A failed writer cleans only its own temporary file and preserves the last
    // successfully committed document.
    const before = await fs.readFile(target, 'utf8');
    const failing = { ...fs, async rename() { throw new Error('simulated rename failure'); } };
    await assert.rejects(writeFileAtomic(failing, target, '{"writer":"failed"}'), /simulated rename failure/);
    assert.equal(await fs.readFile(target, 'utf8'), before);
    assert.deepEqual(await fs.readdir(folder), ['fixture.json']);
    console.log('PASS: 12 concurrent same-millisecond writes; complete JSON; isolated failure cleanup.');
  } finally {
    Date.now = originalNow;
    await fs.rm(folder, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
