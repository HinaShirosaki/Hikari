#!/usr/bin/env node
'use strict';

const { rebuildRecordMarkdown, resolveMarkdownInput } = require('../../src/main/storage/record-markdown/rebuild');

const HELP = `Usage: node scripts/maintenance/migrate-record-markdown.js <workspace-directory|legacy.json|record.md> [--dry-run] [--json]

Convert old protocol and notebook JSON to self-contained Hikari Markdown.
Supports full snapshots, .protocols.json/.notebook-pages.json sidecars and
individual {protocol: ...} / {notebookEntry: ...} records.

  --dry-run  Validate and list planned outputs without writing files.
  --json     Print a machine-readable report including Markdown paths.
  -h, --help Show this help.

Close Hikari before migrating a workspace. Original snapshots stay intact;
legacy per-record JSON receives a one-time *.pre-markdown.json backup and
is retired after the Markdown commits. Hidden typed YAML retains scientific
state in the same Markdown file; assays and gels keep their JSON storage.
Tables, buffer/reaction calculations, assays, gels, files and images are
rendered using the same converter as current Hikari saves.
Existing migrated prose and user annotations are preserved.

Examples:
  npm run migrate:markdown -- /path/to/workspace --dry-run
  npm run migrate:markdown -- /path/to/old-snapshot.json
`;

async function main(args = process.argv.slice(2)) {
  let input = '';
  let dryRun = false;
  let json = false;
  let positional = false;
  for (const arg of args) {
    if (!positional && arg === '--') { positional = true; continue; }
    if (!positional && ['--help', '-h'].includes(arg)) { console.log(HELP); return; }
    if (!positional && arg === '--dry-run') { dryRun = true; continue; }
    if (!positional && arg === '--json') { json = true; continue; }
    if (!positional && arg.startsWith('-')) throw new Error(`Unknown option: ${arg}\n${HELP}`);
    if (input) throw new Error(`Expected one workspace directory, legacy JSON file or record Markdown.\n${HELP}`);
    input = arg;
  }
  if (!input) throw new Error(HELP);
  const { storageRoot } = await resolveMarkdownInput(input);
  const result = await rebuildRecordMarkdown(input, { migrate: true, dryRun });
  if (json) console.log(JSON.stringify({ ...result, storageRoot }, null, 2));
  else {
    console.log(`${dryRun ? 'Dry run: would migrate' : 'Migrated'} ${result.protocols} protocol(s) and ${result.notebooks} notebook page(s).`);
    console.log(`Workspace: ${storageRoot}`);
    console.log(`Markdown files: ${result.markdownPaths.length}`);
    if (dryRun) console.log('No files were written. Use --json to inspect the planned paths.');
  }
  return result;
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });

module.exports = { main };
