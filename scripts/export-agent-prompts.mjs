#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const require = createRequire(import.meta.url);

const {
  renderAgentPromptRegistryMarkdown
} = require(path.join(repoRoot, 'src', 'main', 'helpers', 'agent', 'shared', 'agent-prompt-registry.js'));

const outputArg = process.argv[2];
const outputPath = path.resolve(
  repoRoot,
  outputArg || path.join('docs', 'agent', 'reference', 'agent-prompts.md')
);

const markdown = renderAgentPromptRegistryMarkdown();

await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, markdown, 'utf8');

process.stdout.write(`Wrote ${path.relative(repoRoot, outputPath)}\n`);
