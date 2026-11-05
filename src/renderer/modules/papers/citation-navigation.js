import { normalizePdfBytePayload } from './storage.js';

async function readIngestedPdfPath(api, path) {
  const metadata = await api.readFileBytes(path.replace(/\/[^/]+$/, '/meta.json'));
  const bytes = normalizePdfBytePayload(metadata?.bytes);
  if (!metadata?.ok || !bytes) return '';
  return JSON.parse(new TextDecoder().decode(bytes)).source_pdf_path;
}

// The knowledge record, not a model-authored PDF path or title, identifies the
// downloaded document. This also works for evidence in older saved chats. The
// library record follows moves; meta.json keeps the location from ingest.
export function createPaperCitationNavigator({ state, api, openStoredPaper, paperViewer }) {
  let request = 0;
  return async function openPaperCitation(source = {}) {
    const activeRequest = ++request;
    const root = String(state.settings?.storagePath || '').replace(/\\/g, '/').replace(/\/+$/, '');
    const stale = () => activeRequest !== request
      || root !== String(state.settings?.storagePath || '').replace(/\\/g, '/').replace(/\/+$/, '');
    const path = String(source.path || '').replace(/\\/g, '/');
    const relative = path.startsWith(`${root}/`) ? path.slice(root.length + 1) : '';
    if (!root || !/^KnowledgeBase\/papers\.md\/[^/]+\/[^/]+\.md$/i.test(relative)
      || relative.split('/').some(part => part === '.' || part === '..') || !api?.readFileBytes) {
      return { ok: false };
    }
    const metaPath = relative.replace(/[^/]+$/, 'meta.json');
    const linked = (state.papers || []).find(paper => metaPath === String(
      paper?.knowledgeMetaRelativePath || paper?.knowledge_meta_relative_path || '').replace(/\\/g, '/'));
    const rawPdf = String(linked?.storedRelativePath || await readIngestedPdfPath(api, path) || '').replace(/\\/g, '/');
    // A newer click owns the viewer now, so a replaced request is not a failure.
    if (stale()) return { ok: true, superseded: true };
    const pdf = rawPdf.startsWith(`${root}/`) ? rawPdf.slice(root.length + 1) : rawPdf;
    if (!pdf || /^(?:\/|[a-z]+:)/i.test(pdf) || !/\.pdf$/i.test(pdf)
      || pdf.split('/').some(part => !part || part === '.' || part === '..')
      || /[\u0000-\u001f]/.test(pdf)) return { ok: false };
    const opened = await openStoredPaper({ relativePath: pdf });
    if (stale()) return { ok: true, superseded: true };
    if (!opened) return { ok: false };
    const located = await paperViewer.revealCitation(source.excerpt);
    return { ok: true, located: located === true };
  };
}
