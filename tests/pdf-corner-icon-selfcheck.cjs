// Checks the exported PDF corner mark rasterizes from the vector source at full
// resolution (a blurry mark means it fell back to a small/​missing bitmap).
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '..');

if (!process.versions.electron) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'hikari-pdf-corner-icon-'));
  try {
    const result = require('node:child_process').spawnSync(require('electron'), [__filename, temp], {
      encoding: 'utf8',
      timeout: 60000
    });
    process.stdout.write(result.stdout || '');
    process.stderr.write(result.stderr || '');
    if (result.status !== 0) {
      throw result.error || new Error(`Electron check failed: ${result.status} (${result.signal || ''})`);
    }
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
} else {
  const { app, BrowserWindow } = require('electron');
  const temp = process.argv[2];
  app.setPath('userData', path.join(temp, 'profile'));

  app.whenReady().then(async () => {
    // Load from the repo root so './assets/...' resolves the way index.html does.
    const fixturePath = path.join(root, '.pdf-corner-icon-fixture.html');
    fs.writeFileSync(fixturePath, '<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>');
    const win = new BrowserWindow({ show: false, width: 800, height: 600 });
    try {
      await win.loadURL(pathToFileURL(fixturePath).href);
      const moduleUrl = pathToFileURL(path.join(root, 'src/renderer/modules/pdf-export/branding.js')).href;
      const report = await win.webContents.executeJavaScript(`(async () => {
        const mod = await import(${JSON.stringify(moduleUrl)});
        const dataUrl = await mod.loadHikariPdfIconDataUrl({ monochrome: true });
        if (!dataUrl) return { dataUrl: '' };
        const img = new Image();
        await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = dataUrl; });
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const c = canvas.getContext('2d');
        c.drawImage(img, 0, 0);
        const { data } = c.getImageData(0, 0, canvas.width, canvas.height);
        let opaque = 0;
        let edge = 0;
        for (let i = 3; i < data.length; i += 4) {
          if (data[i] > 250) opaque += 1;
          else if (data[i] > 5) edge += 1;
        }
        return { dataUrl, width: img.naturalWidth, height: img.naturalHeight, opaque, edge };
      })()`);

      if (!report.dataUrl) throw new Error('corner icon rasterized to an empty data URL');
      if (report.width !== 512 || report.height !== 512) {
        throw new Error(`expected a 512x512 raster, got ${report.width}x${report.height}`);
      }
      const total = report.width * report.height;
      if (report.opaque / total < 0.02) {
        throw new Error(`corner icon is nearly blank: ${report.opaque} opaque px`);
      }
      // A crisp vector rasterization is mostly hard pixels; a blurry upscale of a
      // small bitmap drowns in partial alpha.
      const softRatio = report.edge / (report.edge + report.opaque);
      if (softRatio > 0.5) {
        throw new Error(`corner icon looks blurred: ${(softRatio * 100).toFixed(1)}% partial-alpha pixels`);
      }

      const artifactDir = path.join(root, 'artifacts', 'pdf-corner-icon');
      fs.mkdirSync(artifactDir, { recursive: true });
      fs.writeFileSync(
        path.join(artifactDir, 'corner-icon.png'),
        Buffer.from(report.dataUrl.split(',')[1], 'base64')
      );
      console.log(`ok: 512x512 corner icon, ${report.opaque} opaque px, ${(softRatio * 100).toFixed(1)}% soft edge`);
      console.log(`artifact: ${path.join(artifactDir, 'corner-icon.png')}`);
    } finally {
      win.destroy();
      fs.rmSync(fixturePath, { force: true });
      app.exit(0);
    }
  }).catch((error) => {
    console.error(error);
    app.exit(1);
  });
}
