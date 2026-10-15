// The cell-seeding example: its math self-check, and that the folder installs
// as a tool plugin with the copyable client.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const folder = path.join(projectRoot, 'examples/plugins/cell-seeding');

require(path.join(folder, 'seeding.js')).demo();

const { inspectPluginFolder } = require(path.join(projectRoot, 'src/main/lib/inspect-plugin-folder.js'));
const inspected = await inspectPluginFolder({ fs, folderPath: folder });
assert.equal(inspected.ok, true, inspected.error);
assert.equal(inspected.tool, true, 'the example installs as a tool');

const [client, reference] = await Promise.all([
  fs.readFile(path.join(folder, 'hikari.js'), 'utf8'),
  fs.readFile(path.join(projectRoot, 'examples/plugins/notebook-results/hikari.js'), 'utf8')
]);
assert.equal(client, reference, 'the example ships the unmodified copyable client');
console.log('cell-seeding-selfcheck: ok');
