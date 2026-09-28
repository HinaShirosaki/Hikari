#!/usr/bin/env node
'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { createIntakeStore } = require('../../src/main/papers/store/intake/intake-store.js');

async function main() {
  const input = process.argv[2];
  if (!input) throw new Error('Usage: node scripts/maintenance/rebuild-paper-experiments.js /path/to/workspace');
  const workspacePath = path.resolve(input);
  const papersPath = path.join(workspacePath, 'KnowledgeBase', 'papers.md');
  if (!(await fs.stat(papersPath)).isDirectory()) throw new Error(`Expected a paper knowledge folder: ${papersPath}`);
  const result = await createIntakeStore({ workspacePath, fs }).rebuildExperimentDatabase();
  if (!result.ok) throw new Error(result.error);
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
