'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '../..');
const archive = path.resolve(process.argv[2] || path.join(root, 'out/Hikari-darwin-arm64/Hikari.app/Contents/Resources/app.asar'));
const unpacked = `${archive}.unpacked`;
const repoRequire = createRequire(path.join(root, 'package.json'));
const packageRequire = createRequire(path.join(unpacked, 'package.json'));
const asar = repoRequire('@electron/asar');
async function main() {
  const report = { archive, archiveModified: fs.statSync(archive).mtime.toISOString(), checkedAt: new Date().toISOString(), files: [] };
  for (const file of ['src/main/agent/context/agent-memory.js', 'src/main/agent/mcp-contract/direct-tools/memory.js', 'src/main/agent/mcp-contract/direct-tools/index.js', 'src/main/agent/mcp-contract/instructions.js', 'src/main/agent/tools/Tool-call.json', 'src/main/agent/tools/tool-executors/system-executors.js', 'src/main/storage/memory/conclusion-cache.js', 'src/main/storage/memory/conclusion-request.js', 'src/main/storage/memory/project-inputs.js']) {
    try {
      const shipped = asar.extractFile(archive, file);
      report.files.push({ file, present: true, matchesSource: shipped.equals(fs.readFileSync(path.join(root, file))), sha256: crypto.createHash('sha256').update(shipped).digest('hex') });
    } catch (error) { report.files.push({ file, present: false }); }
  }
  const { Client } = packageRequire('@modelcontextprotocol/sdk/client/index.js');
  const { StdioClientTransport } = packageRequire('@modelcontextprotocol/sdk/client/stdio.js');
  const transport = new StdioClientTransport({ command: process.execPath, args: [path.join(unpacked, 'src/main/agent/mcp-contract/stdio-server.js')], env: { PATH: process.env.PATH, HOME: process.env.HOME, HIKARI_AGENT_STORAGE_PATH: path.dirname(__dirname) }, stderr: 'pipe' });
  const client = new Client({ name: 'memory-package-qa', version: '1.0' });
  try {
    await client.connect(transport);
    report.toolNames = (await client.listTools()).tools.map(tool => tool.name);
    report.memoryAdvertised = report.toolNames.includes('memory');
    report.memoryCall = await client.callTool({ name: 'memory', arguments: { action: 'recall' } });
  } finally { await client.close(); }
  fs.writeFileSync(path.join(__dirname, 'package-inspection.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ archive, matchingFiles: report.files.filter(x => x.matchesSource).length, totalChecked: report.files.length, memoryAdvertised: report.memoryAdvertised, memoryCall: report.memoryCall }, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
