import { installPdfJsCompat } from './pdfjs-compat.js';

installPdfJsCompat(globalThis);

await import('../../../../vendor/pdfjs/build/pdf.worker.mjs');
