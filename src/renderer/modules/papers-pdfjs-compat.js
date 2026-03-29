import * as papersPdfJsCompat from './papers/pdfjs-compat.js';

export function installPdfJsCompat(targetGlobal = globalThis) {
  return papersPdfJsCompat.installPdfJsCompat(targetGlobal);
}
