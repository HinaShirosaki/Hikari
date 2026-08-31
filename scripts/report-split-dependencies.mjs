#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareSnapshots } from './split-dependency-report/comparison.mjs';
import { renderDot, renderFunctionCsv, renderMarkdown } from './split-dependency-report/render-report.mjs';
import { compareFileSets, readGitSnapshot, readWorkingTreeSnapshot } from './split-dependency-report/snapshots.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function parseArguments(args) {
  const options = {
    baselineRef: 'HEAD',
    outputPath: '/private/tmp/enana-split-import-export-dependency-map.md'
  };
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--baseline' && args[index + 1]) {
      options.baselineRef = args[index + 1];
      index += 1;
    } else if (args[index] === '--output' && args[index + 1]) {
      options.outputPath = path.resolve(repoRoot, args[index + 1]);
      index += 1;
    } else if (args[index] === '--help') {
      console.log('Usage: node scripts/report-split-dependencies.mjs [--baseline HEAD] [--output path.md]');
      process.exit(0);
    }
  }
  return options;
}

function main() {
  const { baselineRef, outputPath } = parseArguments(process.argv.slice(2));
  const beforeFiles = readGitSnapshot(repoRoot, baselineRef);
  const afterFiles = readWorkingTreeSnapshot(repoRoot);
  const fileChanges = compareFileSets(beforeFiles, afterFiles);
  const report = compareSnapshots({ baselineRef, beforeFiles, afterFiles, fileChanges });
  const extension = path.extname(outputPath);
  const basePath = extension ? outputPath.slice(0, -extension.length) : outputPath;
  const jsonPath = `${basePath}.json`;
  const dotPath = `${basePath}.dot`;
  const csvPath = `${basePath}-functions.csv`;

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, renderMarkdown(report), 'utf8');
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  fs.writeFileSync(dotPath, renderDot(report), 'utf8');
  fs.writeFileSync(csvPath, renderFunctionCsv(report), 'utf8');

  console.log(`Wrote Markdown report: ${outputPath}`);
  console.log(`Wrote JSON report: ${jsonPath}`);
  console.log(`Wrote DOT graph: ${dotPath}`);
  console.log(`Wrote function CSV: ${csvPath}`);
  console.log(JSON.stringify(report.summary, null, 2));
  if (report.newImportIssues.length
    || report.lostExports.some((entry) => entry.afterConsumers.length || entry.publicEntrypoint)) {
    process.exitCode = 1;
  }
}

main();
