import { installPdfJsCompat } from './pdfjs-compat.js';

let pdfJsModulePromise = null;

export function buildViewerAssetUrl(relativePath) {
  if (typeof window === 'undefined' || !window.location?.href) {
    return relativePath;
  }
  return new URL(relativePath, window.location.href).href;
}

async function loadPdfJsModule() {
  if (!pdfJsModulePromise) {
    installPdfJsCompat(globalThis);
    pdfJsModulePromise = import(buildViewerAssetUrl('./vendor/pdfjs/build/pdf.mjs'))
      .then((pdfjsLib) => {
        pdfjsLib.GlobalWorkerOptions.workerSrc = buildViewerAssetUrl('./src/renderer/modules/papers-pdfjs-worker.js');
        return pdfjsLib;
      })
      .catch((error) => {
        pdfJsModulePromise = null;
        throw error;
      });
  }
  return pdfJsModulePromise;
}

export function isRenderingCancelled(error) {
  const message = String(error?.message || error || '');
  return error?.name === 'RenderingCancelledException' || /cancelled/i.test(message);
}

export { loadPdfJsModule };
