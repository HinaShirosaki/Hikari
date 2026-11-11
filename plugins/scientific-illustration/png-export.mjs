const METRES_PER_INCH = 0.0254;
const PHYS = 0x70485973; // pHYs
const IDAT = 0x49444154;
export const DEFAULT_PNG_PPI = 96;
export const MAX_PNG_PPI = Math.floor(0xffffffff * METRES_PER_INCH);

function densityChunk(ppi) {
  const chunk = new Uint8Array(21);
  const fields = new DataView(chunk.buffer);
  const pixelsPerMetre = Math.round(ppi / METRES_PER_INCH);
  fields.setUint32(0, 9);
  fields.setUint32(4, PHYS);
  fields.setUint32(8, pixelsPerMetre);
  fields.setUint32(12, pixelsPerMetre);
  fields.setUint8(16, 1); // Metres
  let crc = 0xffffffff;
  for (const byte of chunk.subarray(4, 17)) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  fields.setUint32(17, crc ^ 0xffffffff);
  return chunk;
}

// Replace the browser's resolution metadata while keeping the pixel data intact.
export function setPngPpi(dataBase64, ppi) {
  if (!Number.isInteger(ppi) || ppi < 1 || ppi > MAX_PNG_PPI) throw new RangeError('Invalid PNG resolution.');
  const png = Uint8Array.fromBase64(dataBase64);
  const fields = new DataView(png.buffer);
  if (png.length >= 8 && fields.getUint32(0) === 0x89504e47 && fields.getUint32(4) === 0x0d0a1a0a) {
    for (let offset = 8; offset + 12 <= png.length;) {
      const end = offset + fields.getUint32(offset) + 12;
      if (end > png.length) break;
      const type = fields.getUint32(offset + 4);
      if (type === PHYS || type === IDAT) {
        const remainder = type === PHYS ? end : offset;
        const density = densityChunk(ppi);
        const output = new Uint8Array(offset + density.length + png.length - remainder);
        output.set(png.subarray(0, offset));
        output.set(density, offset);
        output.set(png.subarray(remainder), offset + density.length);
        return output.toBase64();
      }
      offset = end;
    }
  }
  throw new Error('Could not read the PNG for export.');
}
