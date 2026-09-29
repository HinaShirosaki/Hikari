import { calculateBufferRecipe } from './bench-calculations.js';

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

// A bench-tool result saved onto a notebook page: title/summary text plus an
// optional table { caption, headers, metaRows, rows, footerRows } of strings.
// Accepts both saved field names (result/formula/summary) and live calculator
// ones (resultText/formulaText/summaryText). Invalid entries return null.
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

  return refreshBufferCalculation({
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
  });
}

// A buffer table is only ever the calculator's output for its saved inputs
// (its cells are not editable on the page), so it is rebuilt from them: a page
// saved by an older calculator -- the dropped 6 M NaOH / HCl pH estimate --
// reads what the current one gives.
function refreshBufferCalculation(calculation) {
  if (calculation.type !== 'buffer' || calculation.mode !== 'recipe' || !Array.isArray(calculation.inputs.rows) || !calculation.inputs.rows.length) {
    return calculation;
  }
  const result = calculateBufferRecipe(calculation.inputs);
  return {
    ...calculation,
    table: normalizeNotebookToolCalculationTable(buildBufferCalculationTable(result)) || calculation.table,
    result: result.resultText || '',
    formula: result.formulaText || '',
    summary: result.resultText || result.formulaText || calculation.summary,
    status: result.status || ''
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

function cleanCell(value) {
  return String(value ?? '').trim();
}

// "Template DNA volume = 0.2 ng/uL x 50 uL / [stock concentration]" reads as a
// formula in a Volume column once its own name is stripped off the front.
function formulaAfterName(text) {
  const source = cleanCell(text);
  const match = source.match(/^[^=]*=\s*(.+)$/s);
  return match ? match[1].trim() : source;
}

export function resultTextAfterName(text) {
  const source = String(text || '').trim();
  const match = source.match(/^[^:]+:\s*(.+?)\.?$/s);
  return match ? match[1].trim() : source;
}

export function buildBufferCalculationTable(result) {
  if (!result || result.type !== 'buffer' || result.mode !== 'recipe') {
    return null;
  }
  const rowsByIndex = new Map((Array.isArray(result.inputs?.rows) ? result.inputs.rows : [])
    .map((row) => [Number(row?.rowIndex) || 0, row]));
  const rows = (Array.isArray(result.details) ? result.details : []).map((detail) => {
    const rowIndex = Number(detail?.rowIndex) || 0;
    const rowInput = rowsByIndex.get(rowIndex) || {};
    const rowDetail = Array.isArray(detail.details) ? detail.details[0] : null;
    return [
      cleanCell(rowDetail?.name || detail.inputs?.name || rowInput.name),
      cleanCell(detail.inputs?.molecularWeight || rowInput.molecularWeight),
      cleanCell(rowDetail?.stockConcentration?.text || rowInput.stockConcentration),
      cleanCell(rowDetail?.finalConcentration?.text || rowInput.finalConcentration),
      cleanCell(rowDetail?.quantityText || resultTextAfterName(detail.resultText)),
      // What actually went on the balance -- the lot, which bottle it came from.
      cleanCell(rowInput.note)
    ];
  }).filter((row) => row.some(Boolean));
  const volumeValue = cleanCell(result.inputs?.volumeValue ?? result.inputs?.volumeMl);
  const volumeUnit = cleanCell(result.inputs?.volumeUnit) || 'mL';
  return {
    caption: 'Buffer Preparer',
    metaRows: [[
      'Volume',
      volumeValue ? `${volumeValue} ${volumeUnit}` : '',
      'pH',
      cleanCell(result.inputs?.pH),
      '',
      ''
    ]],
    headers: ['Chemical', 'MW', 'Stock Conc.', 'Final Conc.', 'Mass/Volume', 'Note'],
    rows,
    footerRows: [[
      ['Solvent to add', cleanCell(result.solvent?.text)].filter(Boolean).join(' '),
      '', '', '', '', ''
    ]]
  };
}

function reactionRowCells(result) {
  const reagents = Array.isArray(result?.inputs?.reagents) ? result.inputs.reagents : [];
  const rowsByIndex = new Map(reagents.map((row, index) => [
    Math.max(1, Number(row?.rowIndex) || index + 1),
    row
  ]));
  return (Array.isArray(result?.details) ? result.details : []).map((detail, index) => {
    const rowDetail = (Array.isArray(detail?.details) ? detail.details[0] : null) || {};
    const rowInput = rowsByIndex.get(Math.max(1, Number(detail?.rowIndex) || index + 1)) || {};
    return [
      cleanCell(rowDetail.name || detail?.inputs?.name || rowInput.name),
      cleanCell(rowInput.stockConcentration ?? detail?.inputs?.stockConcentration),
      cleanCell(rowInput.finalConcentration ?? detail?.inputs?.finalConcentration),
      // A row whose concentration is not known yet keeps its formula instead of
      // an empty cell: the volume is still the thing to work out at the bench.
      cleanCell(rowDetail.quantityText)
        || cleanCell(rowInput.volumeFormula)
        || formulaAfterName(detail?.formulaText),
      // What actually went in the tube -- the ng of DNA used, the lot number,
      // whichever miniprep it came from.
      cleanCell(rowInput.note)
    ];
  }).filter((row) => row.some(Boolean));
}

export function buildFixedReactionCalculationTable(result, options = {}) {
  if (!result || result.type !== 'fixed-reaction' || result.mode !== 'reaction') {
    return null;
  }
  const totalVolume = cleanCell(options?.totalVolume || result?.inputs?.totalVolumeValue);
  const totalUnit = cleanCell(result?.inputs?.totalVolumeUnit);
  const extraMetaRows = (Array.isArray(options?.extraMetaRows) ? options.extraMetaRows : [])
    .map((row) => (Array.isArray(row) ? row.map((cell) => cleanCell(cell)) : []))
    .filter((row) => row.some(Boolean));
  const fillVolume = cleanCell(result?.fill?.text) || formulaAfterName(result?.fill?.formula);
  return {
    caption: 'Fixed Volume Reaction',
    metaRows: [
      [
        'Total volume',
        totalVolume && /\D/u.test(totalVolume) ? totalVolume : [totalVolume, totalUnit].filter(Boolean).join(' '),
        '',
        '',
        ''
      ],
      ...extraMetaRows
    ],
    headers: ['Item', 'Stock Conc.', 'Final Conc.', 'Volume', 'Note'],
    rows: reactionRowCells(result),
    footerRows: [[cleanCell(result?.fill?.name || result?.inputs?.fillName || 'Solvent'), '', '', fillVolume, '']]
  };
}

function padCells(cells, width) {
  const source = Array.isArray(cells) ? cells : [];
  return source.concat(Array.from({ length: Math.max(0, width - source.length) }, () => ''));
}

// Which stored input each editable cell writes back to. The Volume column maps
// to the manual volume, so typing a number there overrides whatever the
// concentrations worked out to.
const REACTION_ROW_FIELDS = ['name', 'stockConcentration', 'finalConcentration', 'manualVolumeValue', 'note'];

// The note column is the only empty one by design, so it says what it is for.
const REACTION_FIELD_PLACEHOLDERS = { note: 'ng used, lot, source' };

function editableCellHtml(cell, escapeText, { calculationId, row, field }) {
  const placeholder = REACTION_FIELD_PLACEHOLDERS[field] || '';
  return `<input
    type="text"
    class="biology-notebook-tool-calculation-input"
    value="${escapeText(cell)}"
    aria-label="${escapeText(field)}"
    ${placeholder ? `placeholder="${escapeText(placeholder)}"` : ''}
    data-tool-calculation-id="${escapeText(calculationId)}"
    data-tool-calculation-row="${escapeText(String(row))}"
    data-tool-calculation-field="${escapeText(field)}"
  />`;
}

function renderTableRows(rows, width, escapeText, rowClass = '', edit = null) {
  return (Array.isArray(rows) ? rows : []).map((row, rowIndex) => {
    const cells = padCells(row, width);
    return `<tr${rowClass ? ` class="${rowClass}"` : ''}>${cells.map((cell, index) => {
      const tag = index === 0 ? 'th' : 'td';
      const scope = index === 0 ? ' scope="row"' : '';
      const field = edit ? edit.fieldFor(rowIndex, index) : '';
      const content = field
        ? editableCellHtml(cell, escapeText, { calculationId: edit.calculationId, row: rowIndex, field })
        : escapeText(cell);
      return `<${tag}${scope}>${content}</${tag}>`;
    }).join('')}</tr>`;
  }).join('');
}

function buildCalculationTableHtml(table, escapeText, edit = null) {
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
    renderTableRows(normalized.metaRows, width, escapeText, 'biology-notebook-tool-calculation-meta-row', edit ? {
      calculationId: edit.calculationId,
      // Only the first meta row is the total volume; the rest are notes.
      fieldFor: (rowIndex, cellIndex) => (rowIndex === 0 && cellIndex === 1 ? 'totalVolumeValue' : '')
    } : null),
    renderTableRows(normalized.rows, width, escapeText, '', edit ? {
      calculationId: edit.calculationId,
      fieldFor: (rowIndex, cellIndex) => REACTION_ROW_FIELDS[cellIndex] || ''
    } : null),
    // The fill volume is whatever is left over, so it is never typed in.
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
    return '';
  }

  return normalized.map((calculation) => {
    // A fixed-volume reaction is a starting point, not a verdict: its cells stay
    // editable so the numbers can be matched to what is actually on the bench.
    const edit = calculation.type === 'fixed-reaction' && calculation.mode === 'reaction'
      ? { calculationId: calculation.id }
      : null;
    // The table is the record. A result line and a formula line under it only
    // repeat what its cells already say.
    const table = calculation.table
      ? buildCalculationTableHtml(calculation.table, escapeText, edit)
      : '';
    return `
      <article class="biology-notebook-tool-calculation" data-tool-calculation-id="${escapeText(calculation.id)}">
        <div class="biology-notebook-tool-calculation-head">
          <h5>${escapeText(calculation.title)}</h5>
          <span>${escapeText(calculation.type)}</span>
          <button
            type="button"
            class="ghost-btn biology-notebook-tool-calculation-edit"
            data-tool-calculation-edit="${escapeText(calculation.id)}"
            aria-label="Edit ${escapeText(calculation.title)}"
            title="Edit in the toolbox"
          >
            <svg viewBox="0 0 24 24" role="presentation" aria-hidden="true" focusable="false">
              <path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17v3Z"></path>
              <path d="M14.5 7.5 16.5 9.5"></path>
            </svg>
          </button>
          <button
            type="button"
            class="ghost-btn biology-notebook-tool-calculation-remove"
            data-tool-calculation-remove="${escapeText(calculation.id)}"
            aria-label="Remove ${escapeText(calculation.title)}"
            title="Remove table"
          >
            <svg viewBox="0 0 24 24" role="presentation" aria-hidden="true" focusable="false">
              <path d="M4 7h16M10 4h4M9 7v12M15 7v12M6 7l1 13h10l1-13"></path>
            </svg>
          </button>
        </div>
        ${table}
      </article>
    `;
  }).join('');
}
