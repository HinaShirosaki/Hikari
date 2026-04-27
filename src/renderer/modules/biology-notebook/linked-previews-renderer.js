import {
  buildNotebookAssayPlatePreviewHtml,
  formatLinkedPreviewTimestamp
} from '../notebook-linked-previews.js';

export function formatGelAnalysisTypeLabel(type) {
  if (type === 'western') {
    return 'Western Blot';
  }
  if (type === 'agarose') {
    return 'DNA/RNA Agarose';
  }
  return 'SDS-PAGE';
}

export function formatAssayAnalysisMethodLabel(method) {
  const source = String(method || '').trim();
  if (!source) {
    return 'Analysis plot';
  }
  return source
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function buildLinkedGelPreviewHtml(analysis, previewImage, safeText) {
  const updatedAt = formatLinkedPreviewTimestamp(analysis?.updatedAt);
  const imageHtml = previewImage
    ? `
        <figure class="biology-notebook-linked-preview-figure">
          <img src="${safeText(previewImage)}" alt="${safeText(analysis?.name || 'Linked gel preview')}" />
          <figcaption class="biology-notebook-linked-preview-caption small-note">
            ${safeText(`${formatGelAnalysisTypeLabel(analysis?.analysisType)} · Updated ${updatedAt}`)}
          </figcaption>
        </figure>
      `
    : '<p class="small-note">Save a gel image to show its linked preview here.</p>';

  return `
      <article class="biology-notebook-linked-preview">
        <div class="biology-notebook-linked-preview-head">
          <div class="biology-notebook-linked-preview-copy">
            <h4>${safeText(analysis?.name || 'Linked Gel')}</h4>
            <p class="biology-notebook-linked-preview-meta">${safeText(`${formatGelAnalysisTypeLabel(analysis?.analysisType)} · ${analysis?.projectName || 'No project'}`)}</p>
          </div>
          <span class="small-note">${safeText(updatedAt)}</span>
        </div>
        <div class="biology-notebook-linked-preview-media">
          ${imageHtml}
        </div>
      </article>
    `;
}

function buildSerialDilutionTableHtml({ headers, rows, className, safeText }) {
  if (!rows.length) {
    return '';
  }
  return `
        <div class="assay-serial-dilution-table-wrap">
          <table class="assay-serial-dilution-table ${className}">
            <thead>
              <tr>
                ${headers.map((header) => `<th>${safeText(header)}</th>`).join('')}
              </tr>
            </thead>
            <tbody>
              ${rows.map((cells) => `
                <tr>
                  ${cells.map((cell) => `<td>${safeText(cell)}</td>`).join('')}
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;
}

function buildSerialDilutionSectionHtml(serialDilutionSummary, safeText) {
  const hasContent = Boolean(
    serialDilutionSummary
    && (
      (Array.isArray(serialDilutionSummary.feedbackMessages) && serialDilutionSummary.feedbackMessages.length)
      || (Array.isArray(serialDilutionSummary.initialDilutionRows) && serialDilutionSummary.initialDilutionRows.length)
      || (Array.isArray(serialDilutionSummary.followingDilutionRows) && serialDilutionSummary.followingDilutionRows.length)
      || serialDilutionSummary.hasValidPlans
    )
  );
  if (!hasContent) {
    return '';
  }

  const volumeNote = Number.isFinite(serialDilutionSummary?.volumePerWellUl) && serialDilutionSummary.volumePerWellUl > 0
    ? `<span class="small-note">${safeText(`Volume per well: ${serialDilutionSummary.volumePerWellUl} uL`)}</span>`
    : '';

  const feedbackHtml = (Array.isArray(serialDilutionSummary.feedbackMessages) ? serialDilutionSummary.feedbackMessages : [])
    .map((item) => `
            <p class="small-note ${item?.type === 'error' ? 'assay-serial-dilution-error' : 'assay-serial-dilution-note'}">${safeText(String(item?.text || ''))}</p>
          `).join('');

  const initialHtml = Array.isArray(serialDilutionSummary.initialDilutionRows) && serialDilutionSummary.initialDilutionRows.length
    ? `
              <div class="biology-notebook-linked-assay-serial-dilution-block">
                <p class="small-note">Initial dilution</p>
                ${buildSerialDilutionTableHtml({
                  headers: ['Sample', 'Stock Vol.', 'Buffer Vol.'],
                  rows: serialDilutionSummary.initialDilutionRows.map((row) => [
                    row?.sample || '',
                    row?.stockVolume || '',
                    row?.bufferVolume || ''
                  ]),
                  className: 'assay-serial-dilution-table-compact',
                  safeText
                })}
              </div>
            `
    : '';

  const followingHtml = Array.isArray(serialDilutionSummary.followingDilutionRows) && serialDilutionSummary.followingDilutionRows.length
    ? `
              <div class="biology-notebook-linked-assay-serial-dilution-block">
                <p class="small-note">Following dilution</p>
                ${buildSerialDilutionTableHtml({
                  headers: ['Step', 'Target Conc.', 'From Previous Well', 'Buffer Vol.', 'Transfer / Discard', 'Final Vol.'],
                  rows: serialDilutionSummary.followingDilutionRows.map((row) => [
                    row?.step || '',
                    row?.targetConcentration || '',
                    row?.fromPreviousWell || '',
                    row?.bufferVolume || '',
                    row?.transferOrDiscard || '',
                    row?.finalVolume || ''
                  ]),
                  className: '',
                  safeText
                })}
              </div>
            `
    : (serialDilutionSummary?.hasValidPlans
      ? '<p class="small-note">No downstream dilution steps are needed for this assay.</p>'
      : '');

  return `
        <section class="biology-notebook-linked-assay-serial-dilution">
          <div class="biology-notebook-linked-assay-serial-dilution-head">
            <h5>Serial Dilution</h5>
            ${volumeNote}
          </div>
          ${feedbackHtml}
          ${initialHtml}
          ${followingHtml}
        </section>
      `;
}

export function buildLinkedAssayPreviewHtml(assay, safeText) {
  const latestAnalysis = assay?.latestAnalysis && typeof assay.latestAnalysis === 'object'
    ? assay.latestAnalysis
    : null;
  const plotImage = String(latestAnalysis?.chartDataUrl || '').trim();
  const plateHtml = buildNotebookAssayPlatePreviewHtml(assay, safeText);
  const serialDilutionSummary = assay?.serialDilutionSummary && typeof assay.serialDilutionSummary === 'object'
    ? assay.serialDilutionSummary
    : null;
  const plotHtml = plotImage
    ? `
        <figure class="biology-notebook-linked-preview-figure">
          <img src="${safeText(plotImage)}" alt="${safeText(`${assay?.name || 'Assay'} analysis plot`)}" />
          <figcaption class="biology-notebook-linked-preview-caption small-note">
            ${safeText(`${formatAssayAnalysisMethodLabel(latestAnalysis?.method)} · ${latestAnalysis?.summary || 'Saved analysis plot'}`)}
          </figcaption>
        </figure>
      `
    : '';
  const serialDilutionHtml = buildSerialDilutionSectionHtml(serialDilutionSummary, safeText);

  return `
      <article class="biology-notebook-linked-preview">
        <div class="biology-notebook-linked-preview-head">
          <div class="biology-notebook-linked-preview-copy">
            <h4>${safeText(assay?.name || 'Linked Assay')}</h4>
            <p class="biology-notebook-linked-preview-meta">${safeText(`${assay?.assayNumber || assay?.id || '-'} · ${assay?.plateLabel || `${assay?.wellCount || '-'} well plate`}`)}</p>
          </div>
          <span class="small-note">${safeText(formatLinkedPreviewTimestamp(assay?.updatedAt))}</span>
        </div>
        <div class="biology-notebook-linked-preview-media">
          <div class="biology-notebook-linked-assay-grid">
            ${plateHtml}
          </div>
          ${serialDilutionHtml}
          ${plotHtml}
        </div>
      </article>
    `;
}

export function createLinkedPreviewImageLoader({ readFileBase64 } = {}) {
  const cache = new Map();

  async function resolveGelPreviewImage(analysis) {
    const previewImagePath = String(analysis?.previewImagePath || '').trim();
    if (previewImagePath) {
      if (cache.has(previewImagePath)) {
        return cache.get(previewImagePath);
      }
      if (typeof readFileBase64 === 'function') {
        const response = await readFileBase64(previewImagePath);
        if (response?.ok && response.dataBase64) {
          const dataUrl = `data:image/png;base64,${response.dataBase64}`;
          cache.set(previewImagePath, dataUrl);
          return dataUrl;
        }
      }
    }
    return String(analysis?.previewImageDataUrl || '').trim();
  }

  async function resolveAssayPlotImage(assay) {
    const latestAnalysis = assay?.latestAnalysis && typeof assay.latestAnalysis === 'object'
      ? assay.latestAnalysis
      : null;
    const chartDataUrl = String(latestAnalysis?.chartDataUrl || '').trim();
    if (chartDataUrl) {
      return chartDataUrl;
    }

    const chartPath = String(latestAnalysis?.chartPath || '').trim();
    if (!chartPath) {
      return '';
    }
    if (cache.has(chartPath)) {
      return cache.get(chartPath);
    }
    if (typeof readFileBase64 !== 'function') {
      return '';
    }

    const response = await readFileBase64(chartPath);
    if (!response?.ok || !response.dataBase64) {
      return '';
    }
    const normalizedPath = chartPath.toLowerCase();
    const mimeType = normalizedPath.endsWith('.svg')
      ? 'image/svg+xml'
      : normalizedPath.endsWith('.jpg') || normalizedPath.endsWith('.jpeg')
        ? 'image/jpeg'
        : normalizedPath.endsWith('.webp')
          ? 'image/webp'
          : 'image/png';
    const dataUrl = `data:${mimeType};base64,${response.dataBase64}`;
    cache.set(chartPath, dataUrl);
    return dataUrl;
  }

  function clearCache() {
    cache.clear();
  }

  return {
    resolveGelPreviewImage,
    resolveAssayPlotImage,
    clearCache
  };
}
