#!/usr/bin/env node
'use strict';

const { rebuildRecordMarkdown } = require('../../src/main/storage/record-markdown/rebuild');

async function main() {
  const input = process.argv[2];
  if (!input) throw new Error('Usage: node scripts/maintenance/migrate-record-markdown.js /path/to/workspace');
  console.log(JSON.stringify(await rebuildRecordMarkdown(input, { migrate: true }), null, 2));
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
