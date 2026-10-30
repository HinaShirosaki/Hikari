// Opening a paper's publisher page goes through the host shell, never the
// renderer, so the URL is validated before it leaves the app.
function createExternalLinkOpener({ windowRef } = {}) {
  function normalizeExternalWebsiteUrl(value) {
    const raw = String(value || '').trim();
    if (!raw) {
      return '';
    }
    try {
      const parsed = new URL(raw);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        return '';
      }
      return parsed.toString();
    } catch {
      return '';
    }
  }

  async function openPdfExternalWebsite(url) {
    const normalizedUrl = normalizeExternalWebsiteUrl(url);
    if (!normalizedUrl) {
      return { ok: false, error: 'A valid external website URL is required.' };
    }

    const shouldOpen = typeof windowRef?.confirm === 'function'
      ? windowRef.confirm(`This PDF link opens an external website:\n\n${normalizedUrl}\n\nOpen it in your browser?`)
      : true;
    if (!shouldOpen) {
      return { ok: false, cancelled: true, error: 'External website was not opened.' };
    }

    if (typeof windowRef?.hikariApi?.openExternalUrl !== 'function') {
      return { ok: false, error: 'External link opening is unavailable in this build.' };
    }
    return windowRef.hikariApi.openExternalUrl(normalizedUrl);
  }

  return { normalizeExternalWebsiteUrl, openPdfExternalWebsite };
}

export { createExternalLinkOpener };
