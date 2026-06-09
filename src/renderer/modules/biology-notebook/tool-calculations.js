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
      ? JSON.parse(JSON.stringify(source.inputs))
      : {},
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

export function cloneNotebookToolCalculations(rawCalculations) {
  return normalizeNotebookToolCalculations(rawCalculations);
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
      JSON.stringify(calculation.inputs || {})
    ].filter(Boolean).join(' '))
    .join(' ')
    .trim();
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
    const result = calculation.result
      ? `<p>${escapeText(calculation.result)}</p>`
      : '';
    const formula = calculation.formula
      ? `<p class="small-note biology-notebook-tool-calculation-formula">${escapeText(calculation.formula)}</p>`
      : '';
    return `
      <article class="biology-notebook-tool-calculation" data-tool-calculation-id="${escapeText(calculation.id)}">
        <div class="biology-notebook-tool-calculation-head">
          <h5>${escapeText(calculation.title)}</h5>
          <span>${escapeText(calculation.type)}</span>
        </div>
        ${result}
        ${formula}
      </article>
    `;
  }).join('');
}
