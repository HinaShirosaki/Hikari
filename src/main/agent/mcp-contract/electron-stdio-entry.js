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
  // On Windows Electron swaps process.stdin for a stream that is already at EOF,
  // so the server would exit before the client's first message. MCP clients
  // always attach a pipe, so read fd 0 directly.
  const input = process.platform === 'win32'
    ? new (require('node:net').Socket)({ fd: 0, readable: true, writable: false })
    : process.stdin;
  input.once('end', () => { void close(); });
  input.once('error', () => { void close(1); });
  process.once('SIGTERM', () => { void close(); });
  process.once('SIGINT', () => { void close(); });
  try {
    const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
    server = require('./stdio-server').createAgentMcpStdioServer();
    server.connect(new StdioServerTransport(input, process.stdout)).catch((error) => {
      console.error(`Hikari MCP failed to start: ${error.message}`);
      void close(1);
    });
  } catch (error) {
    console.error(`Hikari MCP failed to load: ${error.message}`);
    void close(1);
  }
}

module.exports = { startElectronMcpStdio };
