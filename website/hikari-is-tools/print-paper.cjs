// Prints the synthetic paper used by the Agent "Papers" screenshot.
// Run from the repository root:
//   node_modules/electron/dist/Electron.app/Contents/MacOS/Electron website/hikari-is-tools/print-paper.cjs
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

app.whenReady().then(async () => {
  try {
    const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
    await win.loadFile(path.resolve(__dirname, '../hikari-is/fixtures/example-lipase-salt-bridges.html'));
    const pdf = await win.webContents.printToPDF({ pageSize: 'Letter', printBackground: true, preferCSSPageSize: true });
    fs.writeFileSync(path.resolve(__dirname, '../hikari-is/fixtures/example-lipase-salt-bridges.pdf'), pdf);
    console.log(`example-lipase-salt-bridges.pdf: ${pdf.length.toLocaleString()} bytes`);
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    app.quit();
  }
});
