// Browser trial adaptation: PDF.js loads from runtime/.
import { installPdfJsCompat } from '../pdfjs-compat.js';

let pdfJsModulePromise = null;

export function buildViewerAssetUrl(relativePath) {
  if (typeof document === 'undefined' || !document.baseURI) {
    return relativePath;
  }
  return new URL(relativePath, document.baseURI).href;
}

async function loadPdfJsModule() {
  if (!pdfJsModulePromise) {
    installPdfJsCompat(globalThis);
    pdfJsModulePromise = import(/* webpackIgnore: true */ buildViewerAssetUrl('./vendor/pdfjs/build/pdf.mjs'))
      .then((pdfjsLib) => {
        pdfjsLib.GlobalWorkerOptions.workerSrc = buildViewerAssetUrl('./src/renderer/modules/papers/pdfjs-worker.js');
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
