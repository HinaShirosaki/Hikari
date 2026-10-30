// Render website favicons from the original vector artwork:
//   node node_modules/electron/cli.js website/hikari-is-tools/build-favicons.cjs
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const site = path.resolve(__dirname, '../hikari-is');
const source = path.resolve(__dirname, '../../assets/icon.svg');
const sizes = [16, 24, 32, 48, 64, 128, 256];

function makeIco(images) {
  const header = Buffer.alloc(6 + 16 * images.length);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(({ size, png }, i) => {
    const entry = 6 + 16 * i;
    header.writeUInt8(size % 256, entry);
    header.writeUInt8(size % 256, entry + 1);
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(png.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += png.length;
  });
  return Buffer.concat([header, ...images.map(image => image.png)]);
}

app.whenReady().then(async () => {
  const original = fs.readFileSync(source, 'utf8');
  if (!original.includes('viewBox="0 0 1024 1024"')
    || !original.includes('<rect x="64" y="64" width="896" height="896" rx="211"')) {
    throw new Error('Update the favicon crop to match assets/icon.svg.');
  }
  // Safari adds a pale backing around a dark favicon, even when every pixel
  // is opaque. Use the bright original mark alone and crop its app-icon padding
  // so it remains legible at tab size, without a dark tile to trigger the frame.
  const svg = original.replace('viewBox="0 0 1024 1024"', 'viewBox="160 156 704 704"')
    .replace(/\s*<rect x="64" y="64" width="896" height="896" rx="211"[^>]*\/>/, '');
  const dataUrl = 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
  // Safari 26 can use the vector directly, without the old tile's cached backing.
  fs.writeFileSync(path.join(site, 'favicon.svg'), svg);
  const window = new BrowserWindow({ show: false });
  await window.loadURL('about:blank');
  const images = [];
  for (const size of sizes) {
    const base64 = await window.webContents.executeJavaScript(`(async () => {
      const image = new Image();
      image.src = ${JSON.stringify(dataUrl)};
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = ${size};
      const context = canvas.getContext('2d');
      context.drawImage(image, 0, 0, ${size}, ${size});
      const pixels = context.getImageData(0, 0, ${size}, ${size}).data;
      if (pixels[3] !== 0 || !pixels.some((value, i) => i % 4 === 3 && value > 0)) {
        throw new Error('Favicon must contain the mark on a transparent background.');
      }
      return canvas.toDataURL('image/png').split(',')[1];
    })()`);
    images.push({ size, png: Buffer.from(base64, 'base64') });
  }
  for (const { size, png } of images.filter(image => [16, 32].includes(image.size))) {
    fs.writeFileSync(path.join(site, `favicon-mark-${size}.png`), png);
    // Keep older cached pages and the conventional favicon URL consistent.
    fs.writeFileSync(path.join(site, `favicon-${size}.png`), png);
  }
  const ico = makeIco(images);
  fs.writeFileSync(path.join(site, 'favicon-mark.ico'), ico);
  fs.writeFileSync(path.join(site, 'favicon.ico'), ico);
  console.log('Generated transparent gold-mark 16px/32px PNGs and seven-size ICO.');
  app.quit();
}).catch(error => {
  console.error(error);
  app.exit(1);
});
