import { FOOTER_BASELINE } from './constants.js';

const HIKARI_PDF_ICON_SOURCE = './assets/loadingicon.png';
const HIKARI_PDF_ICON_RASTER_SIZE = 128;
const HIKARI_PDF_ICON_SIZE = 32;
const HIKARI_PDF_ICON_COLOR = '#185fa5';
const HIKARI_PDF_ICON_SOURCE_CROP = Object.freeze({
  x: 394,
  y: 185,
  width: 465,
  height: 860
});

let hikariPdfIconPromise = null;

export function loadHikariPdfIconDataUrl() {
  if (hikariPdfIconPromise) {
    return hikariPdfIconPromise;
  }
  if (
    typeof Image !== 'function'
    || typeof document === 'undefined'
    || typeof document.createElement !== 'function'
  ) {
    return Promise.resolve('');
  }

  hikariPdfIconPromise = new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        const context2d = canvas?.getContext?.('2d');
        if (!context2d || typeof canvas.toDataURL !== 'function') {
          resolve('');
          return;
        }
        canvas.width = HIKARI_PDF_ICON_RASTER_SIZE;
        canvas.height = HIKARI_PDF_ICON_RASTER_SIZE;
        context2d.clearRect(0, 0, canvas.width, canvas.height);
        const targetHeight = 116;
        const targetWidth = Math.round(
          targetHeight * (HIKARI_PDF_ICON_SOURCE_CROP.width / HIKARI_PDF_ICON_SOURCE_CROP.height)
        );
        const targetX = Math.round((canvas.width - targetWidth) / 2);
        const targetY = Math.round((canvas.height - targetHeight) / 2);
        context2d.drawImage(
          image,
          HIKARI_PDF_ICON_SOURCE_CROP.x,
          HIKARI_PDF_ICON_SOURCE_CROP.y,
          HIKARI_PDF_ICON_SOURCE_CROP.width,
          HIKARI_PDF_ICON_SOURCE_CROP.height,
          targetX,
          targetY,
          targetWidth,
          targetHeight
        );
        context2d.globalCompositeOperation = 'source-in';
        context2d.fillStyle = HIKARI_PDF_ICON_COLOR;
        context2d.fillRect(0, 0, canvas.width, canvas.height);
        context2d.globalCompositeOperation = 'source-over';
        resolve(canvas.toDataURL('image/png'));
      } catch (_error) {
        resolve('');
      }
    };
    image.onerror = () => resolve('');
    image.src = HIKARI_PDF_ICON_SOURCE;
  });

  return hikariPdfIconPromise;
}

export function drawHikariPdfCornerIcon(ctx, pageWidth, pageHeight) {
  const dataUrl = String(ctx?.cornerIconDataUrl || '').trim();
  if (!dataUrl || typeof ctx?.doc?.addImage !== 'function') {
    return false;
  }

  const rightMargin = Math.max(HIKARI_PDF_ICON_SIZE + 8, Number(ctx.marginRight) || 0);
  const x = pageWidth - rightMargin + ((rightMargin - HIKARI_PDF_ICON_SIZE) / 2);
  const y = pageHeight - FOOTER_BASELINE - HIKARI_PDF_ICON_SIZE + 4;
  try {
    ctx.doc.addImage(
      dataUrl,
      'PNG',
      x,
      y,
      HIKARI_PDF_ICON_SIZE,
      HIKARI_PDF_ICON_SIZE,
      undefined,
      'FAST'
    );
    return true;
  } catch (_error) {
    return false;
  }
}

export {
  HIKARI_PDF_ICON_SOURCE,
  HIKARI_PDF_ICON_RASTER_SIZE,
  HIKARI_PDF_ICON_SIZE,
  HIKARI_PDF_ICON_COLOR,
  HIKARI_PDF_ICON_SOURCE_CROP
};
