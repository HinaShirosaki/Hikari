import { extractChemicalStructureCandidates } from '../../modules/personal-inventory/chemical-structure-clipboard.js';
import { chemicalPdfVector } from './chemical-pdf-vector.js';

// Reuse Sample's native reader, preserving SVG/PDF before bitmap previews.
// CDX bytes and unrelated clipboard text never cross the plugin boundary.
export async function readPluginChemicalClipboard(_params, { api }) {
  if (typeof api?.readChemicalClipboard !== 'function') throw new Error('Native chemical clipboard is unavailable in this Hikari build.');
  const clipboard = await api.readChemicalClipboard();
  if (!clipboard?.ok) return null;
  const candidates = Array.isArray(clipboard.candidates) ? clipboard.candidates : [];
  const plain = candidates.find(candidate => candidate.format === 'text/plain')?.text || '';
  const images = extractChemicalStructureCandidates(candidates)
    .filter(candidate => candidate.sourceFormat === 'image')
    .map(candidate => candidate.imageDataUrl);
  const vectors = [], errors = [];
  for (const candidate of candidates) {
    const source = candidate.svg || (/svg/i.test(candidate.format) ? candidate.text : '');
    if (typeof source === 'string' && source.length <= 3000000 && /<svg[\s>]/i.test(source)) vectors.push({ svg: source, source: 'svg' });
  }
  for (const candidate of candidates.filter(item => item.pdfDataBase64)) {
    try { vectors.push({ ...await chemicalPdfVector(candidate.pdfDataBase64), source: 'pdf' }); }
    catch (error) { errors.push(error.message); }
  }
  return { text: plain.includes('hikari.figura.components') && plain.length <= 12000000 ? plain : '',
    vectors, vectorError: errors[0] || '', images: [...new Set(images)].sort((a, b) => Number(b.startsWith('data:image/svg+xml')) - Number(a.startsWith('data:image/svg+xml'))), formats: clipboard.formats || [] };
}
