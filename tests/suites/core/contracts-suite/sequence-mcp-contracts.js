module.exports = function registerSequenceMcpContracts({ scope, __dirname }) {
  scope.test('Sequence MCP workflows preserve templates, coordinates, artifacts and retry atomicity', async () => {
    const { execFile } = require('node:child_process');
    const { promisify } = require('node:util');
    const path = require('node:path');
    await promisify(execFile)(process.execPath, ['--test', path.join(__dirname, 'tests/sequence-mcp-selfcheck.cjs')], { timeout: 60000 });
  });
  scope.test('Official Sequence MCP skill releases references and its examples execute correctly', async () => {
    const { execFile } = require('node:child_process');
    const { promisify } = require('node:util');
    const path = require('node:path');
    await promisify(execFile)(process.execPath, ['--test', path.join(__dirname, 'tests/sequence-mcp-skill-selfcheck.cjs')], { timeout: 60000 });
  });
};
