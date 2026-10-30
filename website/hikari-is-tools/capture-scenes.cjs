// Capture full-page JPEGs of isolated Trial scenes for prepare-screenshots.py.
// Run from the repository root while serve.py is running:
//   node_modules/electron/dist/Electron.app/Contents/MacOS/Electron website/hikari-is-tools/capture-scenes.cjs [--native] <feature> [...]
// Each scene opens trial-app.html?feature=<feature>&capture=1, waits for body[data-trial-ready="true"],
// and records its URL and visible text in capture-manifest.json. Both modes save 3840 px wide frames
// of the 1280 × 800 app at 3×. Zoom mode (default): 3840 × 2446 CSS pixels at 1× density with
// screenshot-capture.css zooming the page. --native (Agent scenes): 1280 × 800 CSS pixels at
// devicePixelRatio 3, for widgets that measure their own text, such as Plotly charts.
const { app, BrowserWindow, screen } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const ORIGIN = process.env.HIKARI_SITE || 'http://127.0.0.1:8790';
const OUT = path.resolve(process.env.HIKARI_CAPTURES || 'tmp/hikari-is-synthetic-captures');
const WIDTH = 3840, HEIGHT = 2446;
const features = process.argv.slice(2).filter(arg => !arg.startsWith('-'));
const native = process.argv.includes('--native');
// Match the app height exactly, including fixed dialogs and their action bars.
const DENSITY = native ? 3 : 1, CSS_WIDTH = WIDTH / DENSITY, CSS_HEIGHT = native ? 800 : HEIGHT;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
// The website ships neither PDF.js nor Plotly. Two Agent screenshots need them, so the desktop
// app's copies are placed in runtime/ for those captures only, then removed.
const REPO = path.resolve(__dirname, '../..'), RUNTIME = path.resolve(__dirname, '../hikari-is/runtime');
const CAPTURE_FILES = {
  'agent-papers': ['vendor/pdfjs', 'src/renderer/modules/papers/pdfjs-worker.js', 'src/renderer/modules/papers/pdfjs-compat.js'],
  'agent-plot': ['vendor/plotly']
};
function addCaptureFiles(feature) {
  const added = (CAPTURE_FILES[feature] || []).filter(file => !fs.existsSync(path.join(RUNTIME, file)));
  for (const file of added) fs.cpSync(path.join(REPO, file), path.join(RUNTIME, file), { recursive: true });
  return added;
}
function removeCaptureFiles(added) {
  for (const file of added) {
    fs.rmSync(path.join(RUNTIME, file), { recursive: true, force: true });
    for (let dir = path.dirname(path.join(RUNTIME, file)); dir !== RUNTIME && !fs.readdirSync(dir).length; dir = path.dirname(dir)) fs.rmdirSync(dir);
  }
}
// Closing one offscreen scene must not end a multi-scene capture run.
app.on('window-all-closed', () => {});

app.whenReady().then(async () => {
  try {
    if (!features.length) throw new Error('Name at least one Trial feature to capture.');
    fs.mkdirSync(OUT, { recursive: true });
    const manifestFile = path.join(OUT, 'capture-manifest.json');
    const manifest = fs.existsSync(manifestFile) ? JSON.parse(fs.readFileSync(manifestFile, 'utf8'))
      : { logicalSize: [1280, 800], renderScale: 3, source: 'Browser-only fictional Hikari trial fixtures', scenes: [] };
    // Offscreen windows inherit the display's scale; page zoom sets the density we want.
    const scale = screen.getPrimaryDisplay().scaleFactor, zoom = DENSITY / scale;
    for (const feature of features) {
      const added = addCaptureFiles(feature);
      try {
        const win = new BrowserWindow({ show: false, width: Math.round(CSS_WIDTH * zoom), height: Math.round(CSS_HEIGHT * zoom), useContentSize: true,
          webPreferences: { offscreen: true, zoomFactor: zoom, partition: `capture-${feature}-${Date.now()}` } });
        win.webContents.setFrameRate(30);
        win.webContents.on('will-prevent-unload', event => event.preventDefault());
        const url = `${ORIGIN}/trial-app.html?feature=${encodeURIComponent(feature)}&capture=1${native ? '&density=native' : ''}`;
        // A fresh offscreen window occasionally reports ERR_FAILED on its first load; retry it.
        for (let attempt = 1; ; attempt++) {
          try { await win.loadURL(url); break; }
          catch (error) { if (attempt === 3) throw error; await sleep(1000); }
        }
        win.webContents.setZoomFactor(zoom);
        const began = Date.now();
        for (;;) {
          const status = await win.webContents.executeJavaScript(`[document.body?.dataset.trialReady, innerWidth, devicePixelRatio, document.querySelector('.trial-boot-error')?.textContent || '']`);
          if (status[3]) throw new Error(`${feature}: ${status[3]}`);
          if (status[0] === 'true') {
            if (status[1] !== CSS_WIDTH || status[2] !== DENSITY) throw new Error(`${feature}: unexpected viewport ${status[1]} at ${status[2]}×`);
            break;
          }
          if (Date.now() - began > 30000) throw new Error(`${feature}: the scene did not become ready.`);
          await sleep(200);
        }
        if (feature === 'calculations') {
          await win.webContents.executeJavaScript("document.querySelector('#biology-notebook-protocol-area details')?.removeAttribute('open')");
        }
        await sleep(1500);   // charts, PDF pages, and fonts settle after the ready signal
        const image = await win.webContents.capturePage();
        const size = image.getSize();
        if (size.width !== WIDTH || size.height !== CSS_HEIGHT * DENSITY) throw new Error(`${feature}: unexpected capture size ${size.width} × ${size.height}.`);
        const jpeg = image.toJPEG(95);
        fs.writeFileSync(path.join(OUT, `${feature}.jpg`), jpeg);
        const auditText = await win.webContents.executeJavaScript('document.body.innerText');
        manifest.scenes = manifest.scenes.filter(scene => scene.name !== feature);
        manifest.scenes.push({ name: feature, feature, url, bytes: jpeg.length, auditText });
        console.log(`${feature}.jpg: ${size.width} × ${size.height}, ${jpeg.length.toLocaleString()} bytes`);
        win.destroy();
      } finally { removeCaptureFiles(added); }
    }
    fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + '\n');
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    app.quit();
  }
});
