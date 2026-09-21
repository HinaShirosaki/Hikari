'use strict';

function startElectronMcpStdio() {
  const { app } = require('electron');
  // stdout belongs exclusively to MCP JSON-RPC, including during module loads.
  console.log = console.error.bind(console);
  console.info = console.error.bind(console);
  if (process.platform === 'darwin') app.setActivationPolicy('prohibited');
  app.on('window-all-closed', () => {});
  let closing = false;
  let server;
  async function close(code = 0) {
    if (closing) return;
    closing = true;
    const timeout = setTimeout(() => app.exit(code), 1000);
    try { await server?.close(); } finally {
      clearTimeout(timeout);
      app.exit(code);
    }
  }
  process.stdin.once('end', () => { void close(); });
  process.stdin.once('error', () => { void close(1); });
  process.once('SIGTERM', () => { void close(); });
  process.once('SIGINT', () => { void close(); });
  try {
    server = require('./stdio-server').createAgentMcpStdioServer();
    server.start().catch((error) => {
      console.error(`Hikari MCP failed to start: ${error.message}`);
      void close(1);
    });
  } catch (error) {
    console.error(`Hikari MCP failed to load: ${error.message}`);
    void close(1);
  }
}

module.exports = { startElectronMcpStdio };
