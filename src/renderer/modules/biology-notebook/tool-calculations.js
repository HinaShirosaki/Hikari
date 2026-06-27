function clonePlainObject(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeTableRows(rawRows, width = 0) {
  return (Array.isArray(rawRows) ? rawRows : [])
    .map((row) => (Array.isArray(row) ? row : []))
    .map((row) => row.map((cell) => String(cell ?? '').trim()))
    .filter((row) => row.some(Boolean))
    .map((row) => {
      if (!width || row.length >= width) {
        return row;
      }
      return row.concat(Array.from({ length: width - row.length }, () => ''));
    });
}

export function normalizeNotebookToolCalculationTable(rawTable) {
  const source = rawTable && typeof rawTable === 'object' ? rawTable : null;
  if (!source) {
    return null;
  }
  const headers = (Array.isArray(source.headers) ? source.headers : [])
    .map((header) => String(header ?? '').trim())
    .filter(Boolean);
  const width = headers.length;
  const metaRows = normalizeTableRows(source.metaRows, width);
  const rows = normalizeTableRows(source.rows, width);
  const footerRows = normalizeTableRows(source.footerRows, width);
  if (!headers.length && !metaRows.length && !rows.length && !footerRows.length) {
    return null;
  }
  return {
    caption: String(source.caption || '').trim(),
    headers,
    metaRows,
    rows,
    footerRows
  };
}

export function normalizeNotebookToolCalculation(rawCalculation) {
  const source = rawCalculation && typeof rawCalculation === 'object' ? rawCalculation : null;
  if (!source) {
    return null;
  }

  const id = String(source.id || '').trim();
  const type = String(source.type || '').trim();
  const title = String(source.title || '').trim();
  const result = String(source.result || source.resultText || '').trim();
  const formula = String(source.formula || source.formulaText || '').trim();
  const summary = String(source.summary || source.summaryText || result || formula).trim();
  if (!id || !type || (!title && !summary)) {
    return null;
  }

  return {
    id,
    type,
    mode: String(source.mode || '').trim(),
    title: title || 'Bench Calculation',
    inputs: source.inputs && typeof source.inputs === 'object'
      ? clonePlainObject(source.inputs)
      : {},
    table: normalizeNotebookToolCalculationTable(source.table),
    result,
    formula,
    summary,
    createdAt: String(source.createdAt || '').trim(),
    status: String(source.status || '').trim()
  };
}

export function normalizeNotebookToolCalculations(rawCalculations) {
  return (Array.isArray(rawCalculations) ? rawCalculations : [])
    .map((item) => normalizeNotebookToolCalculation(item))
    .filter(Boolean);
}

export function formatNotebookToolCalculationLine(rawCalculation) {
  const calculation = normalizeNotebookToolCalculation(rawCalculation);
  if (!calculation) {
    return '';
  }
  const main = calculation.result || calculation.formula || calculation.summary;
  return `${calculation.title}: ${main}`.trim();
}

export function summarizeNotebookToolCalculations(rawCalculations) {
  const calculations = normalizeNotebookToolCalculations(rawCalculations);
  if (!calculations.length) {
    return '';
  }
  const labels = calculations
    .map((calculation) => calculation.title)
    .filter(Boolean)
    .slice(0, 3);
  const suffix = calculations.length > labels.length ? ` + ${calculations.length - labels.length} more` : '';
  return `${calculations.length} calculation${calculations.length === 1 ? '' : 's'}${labels.length ? ` (${labels.join('; ')}${suffix})` : ''}`;
}

export function flattenNotebookToolCalculationsText(rawCalculations) {
  return normalizeNotebookToolCalculations(rawCalculations)
    .map((calculation) => [
      calculation.title,
      calculation.result,
      calculation.formula,
      calculation.summary,
      calculation.table
        ? [
          calculation.table.caption,
          calculation.table.headers.join(' '),
          ...calculation.table.metaRows.map((row) => row.join(' ')),
          ...calculation.table.rows.map((row) => row.join(' ')),
          ...calculation.table.footerRows.map((row) => row.join(' '))
        ].filter(Boolean).join(' ')
        : '',
      JSON.stringify(calculation.inputs || {})
    ].filter(Boolean).join(' '))
    .join(' ')
    .trim();
}

function padCells(cells, width) {
  const source = Array.isArray(cells) ? cells : [];
  return source.concat(Array.from({ length: Math.max(0, width - source.length) }, () => ''));
}

function renderTableRows(rows, width, escapeText, rowClass = '') {
  return (Array.isArray(rows) ? rows : []).map((row) => {
    const cells = padCells(row, width);
    return `<tr${rowClass ? ` class="${rowClass}"` : ''}>${cells.map((cell, index) => {
      const tag = index === 0 ? 'th' : 'td';
      const scope = index === 0 ? ' scope="row"' : '';
      return `<${tag}${scope}>${escapeText(cell)}</${tag}>`;
    }).join('')}</tr>`;
  }).join('');
}

function buildCalculationTableHtml(table, escapeText) {
  const normalized = normalizeNotebookToolCalculationTable(table);
  if (!normalized) {
    return '';
  }
  const width = Math.max(
    normalized.headers.length,
    ...normalized.metaRows.map((row) => row.length),
    ...normalized.rows.map((row) => row.length),
    ...normalized.footerRows.map((row) => row.length),
    1
  );
  const head = normalized.headers.length
    ? `<thead><tr>${padCells(normalized.headers, width).map((header) => `<th scope="col">${escapeText(header)}</th>`).join('')}</tr></thead>`
    : '';
  const body = [
    renderTableRows(normalized.metaRows, width, escapeText, 'biology-notebook-tool-calculation-meta-row'),
    renderTableRows(normalized.rows, width, escapeText),
    renderTableRows(normalized.footerRows, width, escapeText, 'biology-notebook-tool-calculation-footer-row')
  ].join('');
  return `
    <div class="biology-notebook-tool-calculation-table-wrap">
      <table class="biology-notebook-tool-calculation-table">
        ${head}
        <tbody>${body}</tbody>
      </table>
    </div>
  `;
}

export function buildNotebookToolCalculationsHtml({
  calculations,
  safeText
} = {}) {
  const escapeText = typeof safeText === 'function' ? safeText : (value) => String(value || '');
  const normalized = normalizeNotebookToolCalculations(calculations);
  if (!normalized.length) {
    return '<p class="small-note biology-notebook-tool-calculation-empty">Recorded bench calculations will appear here.</p>';
  }

  return normalized.map((calculation) => {
    const table = calculation.table
      ? buildCalculationTableHtml(calculation.table, escapeText)
      : '';
    const result = calculation.result && !table
      ? `<p>${escapeText(calculation.result)}</p>`
      : '';
    const formula = calculation.formula && !table
      ? `<p class="small-note biology-notebook-tool-calculation-formula">${escapeText(calculation.formula)}</p>`
      : '';
    return `
      <article class="biology-notebook-tool-calculation" data-tool-calculation-id="${escapeText(calculation.id)}">
        <div class="biology-notebook-tool-calculation-head">
          <h5>${escapeText(calculation.title)}</h5>
          <span>${escapeText(calculation.type)}</span>
        </div>
        ${table}
        ${result}
        ${formula}
      </article>
    `;
  }).join('');
}
