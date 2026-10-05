export function alphaBounds(pixels, width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || pixels.length !== width * height * 4) throw new Error('Invalid raster pixels.');
  let left = width, top = height, right = -1, bottom = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    // Keep every nonzero alpha value, including faint antialiasing and shadows.
    if (pixels[(y * width + x) * 4 + 3] === 0) continue;
    left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y);
  }
  return right < 0 ? null : { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
}

export function fitRasterBox(width, height, requestedWidth = width) {
  if (![width, height, requestedWidth].every(value => Number.isFinite(value) && value > 0)) throw new Error('Invalid raster dimensions.');
  const minimum = 1 / Math.min(width, height), maximum = 8000 / Math.max(width, height);
  if (minimum > maximum) throw new Error('The raster aspect ratio exceeds canvas object limits. Use a less extreme crop.');
  const scale = Math.min(maximum, Math.max(minimum, requestedWidth / width));
  return { width: width * scale, height: height * scale };
}

export async function prepareRaster(dataUrl, { trim = false } = {}) {
  const image = await new Promise((resolve, reject) => {
    const image = new Image(); image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Could not decode raster artwork.')); image.src = dataUrl;
  });
  const width = image.naturalWidth, height = image.naturalHeight;
  if (!width || !height || width * height > 64000000) throw new Error('Raster images must be at most 64 megapixels.');
  const result = { dataUrl, width, height, original_width: width, original_height: height, trimmed: false };
  if (!trim || !dataUrl.startsWith('data:image/png;')) return result;
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(image, 0, 0);
  const bounds = alphaBounds(ctx.getImageData(0, 0, width, height).data, width, height);
  if (!bounds) throw new Error('The PNG is fully transparent. Generate visible artwork before importing it.');
  if (bounds.width === width && bounds.height === height) return result;
  const cropped = document.createElement('canvas'); cropped.width = bounds.width; cropped.height = bounds.height;
  cropped.getContext('2d').drawImage(image, bounds.x, bounds.y, bounds.width, bounds.height, 0, 0, bounds.width, bounds.height);
  return { ...result, dataUrl: cropped.toDataURL('image/png'), width: bounds.width, height: bounds.height, trimmed: true, crop: bounds };
}
