// Universal HTML/CSS template for protocol and notebook PDF exports.
//
// Renderer-side only — produces an HTML string that the main process feeds
// into a hidden BrowserWindow + webContents.printToPDF. The same primitives
// cover protocols (purpose, materials, steps, troubleshooting) and notebook
// entries (filled steps, linked results, notes, result tables).

export const PAGE_SIZE = 'Letter';
export const PAGE_MARGINS_INCHES = { top: 0.6, right: 0.7, bottom: 0.7, left: 0.7 };

export const STYLES = `
  @page { size: Letter; margin: 0.6in 0.7in 0.7in 0.7in; }
  @page :first { margin-top: 0.9in; }
  @page {
    @bottom-right {
      content: counter(page) " / " counter(pages);
      font: 9pt/1 -apple-system, "Segoe UI", Roboto, sans-serif;
      color: #6b7280;
    }
  }

  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fff; color: #1f2933; }
  body {
    font: 11pt/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    -webkit-font-smoothing: antialiased;
  }

  .hikari-pdf { padding: 0; }

  .pdf-cover { border-bottom: 1px solid #d6dbe2; padding-bottom: 14pt; margin-bottom: 14pt; }
  .pdf-kind { text-transform: uppercase; letter-spacing: 0.08em; font-size: 9pt; color: #6b7280; margin: 0; }
  .pdf-title { font-size: 22pt; line-height: 1.2; margin: 2pt 0 4pt; color: #111; }
  .pdf-subtitle { color: #4b5563; margin: 0; font-size: 11pt; }
  .pdf-meta { display: grid; grid-template-columns: max-content 1fr max-content 1fr; gap: 2pt 14pt; margin-top: 10pt; font-size: 10pt; }
  .pdf-meta dt { color: #6b7280; }
  .pdf-meta dd { margin: 0; }

  .pdf-section { margin: 12pt 0; break-inside: avoid-page; page-break-inside: avoid; }
  .pdf-section > h2 {
    font-size: 14pt;
    margin: 0 0 6pt;
    padding-bottom: 2pt;
    border-bottom: 1px solid #e5e7eb;
    color: #111;
  }
  .pdf-section > h3 { font-size: 12pt; margin: 8pt 0 4pt; color: #111; }

  .kv { display: grid; grid-template-columns: max-content 1fr; gap: 2pt 10pt; margin: 0; }
  .kv dt { color: #6b7280; }
  .kv dd { margin: 0; }

  .prose p { margin: 4pt 0; }
  .prose ul, .prose ol { margin: 4pt 0 8pt 18pt; padding: 0; }
  .prose li { margin: 2pt 0; }

  .steps { padding-left: 1.4em; margin: 4pt 0; }
  .steps > li { margin: 4pt 0; break-inside: avoid; page-break-inside: avoid; }
  .steps .ph { padding: 0 2pt; border-radius: 2pt; }
  .steps .ph.filled { background: #eef5ff; color: #1e3a8a; }
  .steps .ph.empty { color: #9ca3af; font-style: italic; }

  table { width: 100%; border-collapse: collapse; font-size: 10pt; margin: 6pt 0; }
  thead { display: table-header-group; }
  tr { break-inside: avoid; page-break-inside: avoid; }
  th, td { border: 1px solid #c0c6cf; padding: 4pt 6pt; vertical-align: top; text-align: left; }
  th { background: #eef1f5; font-weight: 600; }

  figure { margin: 8pt 0; text-align: center; break-inside: avoid; page-break-inside: avoid; }
  figure img { max-width: 100%; max-height: 4.5in; object-fit: contain; }
  figcaption { font-size: 9.5pt; color: #4b5563; margin-top: 4pt; }

  .linked { border: 1px solid #d6dbe2; border-radius: 6pt; padding: 8pt 10pt; margin: 8pt 0; background: #fafbfc; break-inside: avoid; page-break-inside: avoid; }
  .linked > h3 { margin-top: 0; }

  .small-note { color: #6b7280; font-size: 9.5pt; }
  [hidden] { display: none !important; }
`;

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(value) {
  return escapeHtml(value);
}

function paragraphsHtml(text) {
  const trimmed = String(text ?? '').trim();
  if (!trimmed) {
    return '<p class="small-note">—</p>';
  }
  return trimmed
    .split(/\n{2,}/)
    .map((para) => `<p>${escapeHtml(para).replace(/\n/g, '<br/>')}</p>`)
    .join('');
}

export const block = {
  kvList(pairs) {
    const rows = (Array.isArray(pairs) ? pairs : [])
      .filter(([, value]) => String(value ?? '').trim() !== '')
      .map(([label, value]) => `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd>`)
      .join('');
    return rows ? `<dl class="kv">${rows}</dl>` : '<p class="small-note">—</p>';
  },

  prose(text) {
    return `<div class="prose">${paragraphsHtml(text)}</div>`;
  },

  // Each step: a string, or { segments: [{ text, kind?: 'filled'|'empty' }] }
  stepList(steps) {
    const items = (Array.isArray(steps) ? steps : []).map((step) => {
      if (step && Array.isArray(step.segments)) {
        const inner = step.segments.map((seg) => {
          const text = escapeHtml(seg?.text ?? '');
          if (seg?.kind === 'filled') return `<span class="ph filled">${text}</span>`;
          if (seg?.kind === 'empty') return `<span class="ph empty">${text}</span>`;
          return text;
        }).join('');
        return `<li>${inner}</li>`;
      }
      return `<li>${escapeHtml(step)}</li>`;
    }).join('');
    return items ? `<ol class="steps">${items}</ol>` : '<p class="small-note">—</p>';
  },

  dataTable(headers, rows) {
    const safeHeaders = Array.isArray(headers) ? headers : [];
    const safeRows = Array.isArray(rows) ? rows : [];
    if (!safeRows.length) {
      return '<p class="small-note">—</p>';
    }
    const thead = safeHeaders.length
      ? `<thead><tr>${safeHeaders.map((h) => `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead>`
      : '';
    const tbody = `<tbody>${safeRows
      .map((row) => {
        const cells = Array.isArray(row) ? row : [];
        return `<tr>${cells.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`;
      })
      .join('')}</tbody>`;
    return `<table>${thead}${tbody}</table>`;
  },

  figure(src, caption = '') {
    const source = String(src ?? '').trim();
    if (!source) {
      return caption ? `<p class="small-note">${escapeHtml(caption)}</p>` : '';
    }
    const cap = caption ? `<figcaption>${escapeHtml(caption)}</figcaption>` : '';
    return `<figure><img src="${escapeAttr(source)}" alt="${escapeAttr(caption)}"/>${cap}</figure>`;
  },

  linkedCard({ title, meta, figureSrc, caption } = {}) {
    const parts = [];
    if (title) parts.push(`<h3>${escapeHtml(title)}</h3>`);
    if (Array.isArray(meta) && meta.length) parts.push(block.kvList(meta));
    if (figureSrc) parts.push(block.figure(figureSrc, caption));
    return `<aside class="linked">${parts.join('')}</aside>`;
  }
};

function renderSection(section) {
  if (!section || typeof section !== 'object') return '';
  const heading = section.heading ? `<h2>${escapeHtml(section.heading)}</h2>` : '';
  const body = String(section.html ?? '');
  return `<section class="pdf-section"${section.id ? ` data-section="${escapeAttr(section.id)}"` : ''}>${heading}${body}</section>`;
}

function renderCover({ kind, title, subtitle, meta }) {
  const parts = [];
  if (kind) parts.push(`<p class="pdf-kind">${escapeHtml(kind)}</p>`);
  parts.push(`<h1 class="pdf-title">${escapeHtml(title || 'Untitled')}</h1>`);
  if (subtitle) parts.push(`<p class="pdf-subtitle">${escapeHtml(subtitle)}</p>`);
  if (Array.isArray(meta) && meta.length) {
    const rows = meta
      .filter(([, value]) => String(value ?? '').trim() !== '')
      .map(([label, value]) => `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd>`)
      .join('');
    if (rows) parts.push(`<dl class="pdf-meta">${rows}</dl>`);
  }
  return `<header class="pdf-cover">${parts.join('')}</header>`;
}

// Build a full HTML document ready for printToPDF.
//   kind:     'Protocol' | 'Notebook entry' | ...   (cover eyebrow text)
//   title:    main title
//   subtitle: optional secondary line
//   meta:     [[label, value], ...] shown in the cover grid
//   sections: [{ id?, heading?, html }]  — html should come from `block.*`
//   docKind:  'protocol' | 'notebook' (data-kind attribute, for future theming)
//   lang:     html lang attribute (defaults to 'en')
//   extraStyles: appended after STYLES if callers need to tweak
export function buildDocumentHtml({
  kind = '',
  title = '',
  subtitle = '',
  meta = [],
  sections = [],
  docKind = '',
  lang = 'en',
  extraStyles = ''
} = {}) {
  const cover = renderCover({ kind, title, subtitle, meta });
  const main = `<main>${(Array.isArray(sections) ? sections : []).map(renderSection).join('')}</main>`;
  const dataKindAttr = docKind ? ` data-kind="${escapeAttr(docKind)}"` : '';
  return `<!DOCTYPE html>
<html lang="${escapeAttr(lang)}">
<head>
<meta charset="utf-8"/>
<title>${escapeHtml(title || kind || 'Export')}</title>
<style>${STYLES}${extraStyles || ''}</style>
</head>
<body>
<article class="hikari-pdf"${dataKindAttr}>${cover}${main}</article>
</body>
</html>`;
}
