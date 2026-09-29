// Regenerates assets/icon.{png,icns,ico} from assets/icon.svg (macOS host, for iconutil):
//   npx electron scripts/build-icons.cjs
// macOS art sits on Apple's 1024 grid (824 plate at 100) so it matches other Dock icons;
// Windows art fills its tile, as Windows icons do.
const { app, BrowserWindow } = require('electron');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const assets = path.join(__dirname, '..', 'assets');
const PLATE = { x: 64, size: 896 }; // the navy plate inside icon.svg's 1024 view box

// Draws the svg so its plate covers [inset, size - inset] of a size×size canvas.
function renderInPage(svg, size, inset) {
  return `(async () => {
    const img = new Image();
    img.src = 'data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}';
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = ${size};
    const k = (${size} - 2 * ${inset}) / ${PLATE.size};
    canvas.getContext('2d').drawImage(img, ${inset} - ${PLATE.x} * k, ${inset} - ${PLATE.x} * k, 1024 * k, 1024 * k);
    return canvas.toDataURL('image/png').split(',')[1];
  })()`;
}

function ico(pngs) {
  const header = Buffer.alloc(6 + 16 * pngs.length);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  let offset = header.length;
  pngs.forEach(({ size, png }, i) => {
    const entry = 6 + 16 * i;
    header.writeUInt8(size % 256, entry); // 0 means 256
    header.writeUInt8(size % 256, entry + 1);
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(png.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += png.length;
  });
  return Buffer.concat([header, ...pngs.map(p => p.png)]);
}

app.whenReady().then(async () => {
  const svg = fs.readFileSync(path.join(assets, 'icon.svg'), 'utf8');
  const win = new BrowserWindow({ show: false });
  await win.loadURL('about:blank');
  const render = async (size, inset) => Buffer.from(await win.webContents.executeJavaScript(renderInPage(svg, size, inset)), 'base64');

  const macPng = size => render(size, size * 100 / 1024);
  fs.writeFileSync(path.join(assets, 'icon.png'), await macPng(1024));

  const iconset = fs.mkdtempSync(path.join(os.tmpdir(), 'hikari-icon-')) + '/icon.iconset';
  fs.mkdirSync(iconset);
  for (const size of [16, 32, 128, 256, 512]) {
    fs.writeFileSync(path.join(iconset, `icon_${size}x${size}.png`), await macPng(size));
    fs.writeFileSync(path.join(iconset, `icon_${size}x${size}@2x.png`), await macPng(size * 2));
  }
  execFileSync('iconutil', ['-c', 'icns', iconset, '-o', path.join(assets, 'icon.icns')]);

  const winPngs = [];
  for (const size of [16, 24, 32, 48, 64, 128, 256]) {
    winPngs.push({ size, png: await render(size, Math.floor(size / 20)) });
  }
  fs.writeFileSync(path.join(assets, 'icon.ico'), ico(winPngs));
  app.quit();
});
