#!/usr/bin/env node
'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { withKnowledgeDatabaseWrite, persistKnowledgeDatabase } = require('../../src/main/papers/store/paper-knowledge-store.js');

async function main() {
  const input = process.argv[2];
  if (!input) throw new Error('Usage: node scripts/maintenance/compact-paper-knowledge-index.js /path/to/KnowledgeBase/knowledge.index.sqlite');
  const file = path.resolve(input);
  if (path.basename(file) !== 'knowledge.index.sqlite'
    || !['KnowledgeBase', 'KnowledgeDatabase'].includes(path.basename(path.dirname(file)))) {
    throw new Error('Expected a knowledge.index.sqlite inside KnowledgeBase or KnowledgeDatabase.');
  }
  const before = (await fs.stat(file)).size;
  await withKnowledgeDatabaseWrite(file, (db) => persistKnowledgeDatabase(file, db));
  const after = (await fs.stat(file)).size;
  console.log(JSON.stringify({ path: file, before_bytes: before, after_bytes: after,
    backup_path: await fs.access(`${file}.pre-compact.bak`).then(() => `${file}.pre-compact.bak`, () => null) }, null, 2));
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
