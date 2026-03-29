import { escapeHtml } from '../tool-box/common.js';
import { DEFAULT_MAX_RECORDS } from './constants.js';
import { alignSequenceToReference } from './alignment.js';
import { parseAb1Record, parseInputRecords } from './parsing.js';

function getFileExtension(name) {
  const text = String(name || '').trim().toLowerCase();
  const match = text.match(/\.([a-z0-9]+)$/u);
  return match?.[1] || '';
}

function stripExtension(name, fallback = 'record') {
  const trimmed = String(name || '').trim();
  if (!trimmed) {
    return fallback;
  }
  return trimmed.replace(/\.[^.]+$/u, '') || fallback;
}

function clampIndex(value, length) {
  const safeLength = Math.max(0, Number(length) || 0);
  if (!safeLength) {
    return 0;
  }
  const numeric = Math.floor(Number(value) || 0);
  return Math.max(0, Math.min(safeLength - 1, numeric));
}

function createEmptySourceState(role) {
  return {
    role,
    fileName: '',
    format: '',
    records: [],
    warnings: [],
    errors: [],
    selectedRecordIndex: 0
  };
}

function isRecordObject(value) {
  return Boolean(value && typeof value === 'object' && typeof value.sequence === 'string');
}

function coerceArrayBuffer(value) {
  if (value instanceof ArrayBuffer) {
    return value;
  }
  if (ArrayBuffer.isView(value)) {
    return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
  }
  return null;
}

async function readTextInput(input, readFileAsText) {
  if (typeof input === 'string') {
    return input;
  }

  const source = input?.file || input;
  if (typeof source?.text === 'function') {
    return await source.text();
  }
  if (typeof input?.text === 'string') {
    return input.text;
  }
  if (typeof input?.content === 'string') {
    return input.content;
  }
  if (source && typeof readFileAsText === 'function') {
    return await readFileAsText(source);
  }
  throw new Error('Unable to read the selected text input.');
}

async function readArrayBufferInput(input, readFileAsArrayBuffer) {
  const direct = coerceArrayBuffer(input?.arrayBuffer ?? input?.buffer ?? input);
  if (direct) {
    return direct;
  }

  const source = input?.file || input;
  if (typeof source?.arrayBuffer === 'function') {
    return await source.arrayBuffer();
  }
  if (source && typeof readFileAsArrayBuffer === 'function') {
    return await readFileAsArrayBuffer(source);
  }
  throw new Error('Unable to read the selected binary input.');
}

function normalizeParsedBundle(parsed, fallbackName) {
  const safeParsed = parsed && typeof parsed === 'object' ? parsed : {};
  const records = Array.isArray(safeParsed.records) ? safeParsed.records : [];
  const warnings = Array.isArray(safeParsed.warnings) ? safeParsed.warnings : [];
  const errors = Array.isArray(safeParsed.errors) ? safeParsed.errors : [];

  return {
    format: String(safeParsed.format || '').trim() || 'unknown',
    records: records.map((record, index) => ({
      ...record,
      name: String(record?.name || '').trim() || `${fallbackName || 'record'}_${index + 1}`
    })),
    warnings,
    errors
  };
}

async function parseAlignmentInput(role, input, helpers = {}) {
  if (Array.isArray(input?.records)) {
    return normalizeParsedBundle(input, role);
  }

  if (isRecordObject(input?.record)) {
    return normalizeParsedBundle({
      format: String(input?.record?.sourceFormat || 'external'),
      records: [input.record],
      warnings: [],
      errors: []
    }, role);
  }

  if (isRecordObject(input)) {
    return normalizeParsedBundle({
      format: String(input?.sourceFormat || 'external'),
      records: [input],
      warnings: [],
      errors: []
    }, role);
  }

  if (typeof input?.sequence === 'string') {
    return normalizeParsedBundle({
      format: String(input?.sourceFormat || 'raw'),
      records: [input],
      warnings: [],
      errors: []
    }, role);
  }

  const name = String(input?.name || input?.fileName || input?.file?.name || input?.label || '').trim();
  const extension = getFileExtension(name);
  const isAb1 = extension === 'ab1' || extension === 'abi' || String(input?.format || input?.sourceFormat || '').toLowerCase() === 'ab1';
  if (isAb1) {
    if (role === 'reference') {
      throw new Error('AB1 traces are only supported for the query input.');
    }
    const buffer = await readArrayBufferInput(input, helpers.readFileAsArrayBuffer);
    return normalizeParsedBundle(parseAb1Record(buffer, { name: stripExtension(name, 'sequencing_trace') }), role);
  }

  const text = await readTextInput(input, helpers.readFileAsText);
  const parsed = normalizeParsedBundle(parseInputRecords(text, { maxRecords: DEFAULT_MAX_RECORDS }), stripExtension(name, role));
  if (parsed.format === 'fastq') {
    throw new Error('Sequencing alignment v1 accepts AB1, FASTA, GenBank, or plain sequence text inputs, not FASTQ.');
  }
  return parsed;
}

function describeSelectedRecord(record) {
  if (!record?.sequence?.length) {
    return 'No record selected.';
  }
  const topology = String(record.topology || 'linear');
  const format = String(record.sourceFormat || 'unknown').toUpperCase();
  return `${record.name} | ${record.sequence.length.toLocaleString()} bp | ${topology} | ${format}`;
}

function countNonGapCharacters(text) {
  return String(text || '').replace(/-/g, '').length;
}

function formatBlockRange(start, end) {
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    return '-';
  }
  return `${start.toLocaleString()}-${end.toLocaleString()}`;
}

function formatReferenceSpan(span, referenceLength) {
  const safeLength = Math.max(1, Number(referenceLength) || 1);
  const safeSpan = span && typeof span === 'object' ? span : {};
  const start = Math.max(0, Number(safeSpan.start) || 0);
  const end = Math.max(0, Number(safeSpan.end) || 0);
  if (!safeSpan.wraps) {
    return `${(start + 1).toLocaleString()}..${Math.max(start + 1, end).toLocaleString()}`;
  }
  if (end <= 0) {
    return `${(start + 1).toLocaleString()}..${safeLength.toLocaleString()} (wraps to origin)`;
  }
  return `${(start + 1).toLocaleString()}..${safeLength.toLocaleString()}, 1..${end.toLocaleString()}`;
}

function formatRange(start, end) {
  const safeStart = Math.max(0, Number(start) || 0);
  const safeEnd = Math.max(safeStart, Number(end) || safeStart);
  if (safeStart === safeEnd) {
    return `at ${(safeStart + 1).toLocaleString()}`;
  }
  return `${(safeStart + 1).toLocaleString()}..${safeEnd.toLocaleString()}`;
}

function formatReferenceRange(start, end, referenceLength) {
  const safeLength = Math.max(1, Number(referenceLength) || 1);
  const safeStart = Math.max(0, Number(start) || 0);
  const safeEnd = Math.max(0, Number(end) || 0);
  if (safeStart === safeEnd) {
    const display = safeStart >= safeLength ? safeStart - safeLength : safeStart;
    return `at ${(display + 1).toLocaleString()}`;
  }
  if (safeEnd >= safeStart) {
    return `${(safeStart + 1).toLocaleString()}..${safeEnd.toLocaleString()}`;
  }
  if (safeEnd <= 0) {
    return `${(safeStart + 1).toLocaleString()}..${safeLength.toLocaleString()} (wrap)`;
  }
  return `${(safeStart + 1).toLocaleString()}..${safeLength.toLocaleString()}, 1..${safeEnd.toLocaleString()}`;
}

function buildAlignmentPrettyHtml(result) {
  const reference = String(result?.alignedReference || '');
  const markers = String(result?.alignedMarkers || '');
  const query = String(result?.alignedQuery || '');
  if (!reference.length || !query.length) {
    return '<p class="small-note">Aligned reference/query blocks will appear here.</p>';
  }

  const lineWidth = 80;
  let referenceCount = 0;
  let queryCount = 0;
  const blocks = [];

  for (let offset = 0; offset < reference.length; offset += lineWidth) {
    const referenceChunk = reference.slice(offset, offset + lineWidth);
    const markerChunk = markers.slice(offset, offset + lineWidth);
    const queryChunk = query.slice(offset, offset + lineWidth);
    const referenceChunkCount = countNonGapCharacters(referenceChunk);
    const queryChunkCount = countNonGapCharacters(queryChunk);
    const referenceStart = referenceChunkCount ? referenceCount + 1 : referenceCount;
    const queryStart = queryChunkCount ? queryCount + 1 : queryCount;
    referenceCount += referenceChunkCount;
    queryCount += queryChunkCount;

    blocks.push(`
      <div class="sequence-viewer-alignment-block">
        <div class="sequence-viewer-alignment-row">
          <div class="sequence-viewer-alignment-row-label">REF ${escapeHtml(formatBlockRange(referenceStart, referenceCount))}</div>
          <pre>${escapeHtml(referenceChunk)}</pre>
        </div>
        <div class="sequence-viewer-alignment-row">
          <div class="sequence-viewer-alignment-row-label">MARK</div>
          <pre>${escapeHtml(markerChunk)}</pre>
        </div>
        <div class="sequence-viewer-alignment-row">
          <div class="sequence-viewer-alignment-row-label">QRY ${escapeHtml(formatBlockRange(queryStart, queryCount))}</div>
          <pre>${escapeHtml(queryChunk)}</pre>
        </div>
      </div>
    `);
  }

  return blocks.join('');
}

function buildDifferenceTableHtml(result, referenceRecord) {
  const differences = Array.isArray(result?.differences) ? result.differences : [];
  if (!differences.length) {
    return '<p class="small-note">No mismatches or indels were detected in the best alignment.</p>';
  }

  const referenceLength = Math.max(1, Number(referenceRecord?.sequence?.length) || 1);
  const rows = differences
    .map((difference) => `
      <tr>
        <td>${escapeHtml(difference.type || '-')}</td>
        <td>${escapeHtml(formatReferenceRange(difference.referenceStart, difference.referenceEnd, referenceLength))}</td>
        <td>${escapeHtml(formatRange(difference.queryStart, difference.queryEnd))}</td>
        <td class="sequence-viewer-alignment-diff-seq">${escapeHtml(difference.referenceBases || '-')}</td>
        <td class="sequence-viewer-alignment-diff-seq">${escapeHtml(difference.queryBases || '-')}</td>
      </tr>
    `)
    .join('');

  return `
    <table class="sequence-viewer-alignment-diff-table">
      <thead>
        <tr>
          <th>Type</th>
          <th>Reference</th>
          <th>Query</th>
          <th>Reference Bases</th>
          <th>Query Bases</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

export function createSequenceViewerAlignmentController(config = {}) {
  const elements = config?.elements || {};
  const setStatus = typeof config?.setStatus === 'function' ? config.setStatus : () => {};
  const setLocalWorkspaceVisibility = typeof config?.setLocalWorkspaceVisibility === 'function'
    ? config.setLocalWorkspaceVisibility
    : () => {};
  const onNavigateDetail = typeof config?.onNavigateDetail === 'function' ? config.onNavigateDetail : null;
  const readFileAsText = typeof config?.readFileAsText === 'function' ? config.readFileAsText : async () => '';
  const readFileAsArrayBuffer = typeof config?.readFileAsArrayBuffer === 'function' ? config.readFileAsArrayBuffer : async () => new ArrayBuffer(0);

  const state = {
    reference: createEmptySourceState('reference'),
    query: createEmptySourceState('query'),
    result: null,
    isRunning: false,
    statusMessage: 'Load a reference and a query to begin.',
    statusIsError: false
  };

  function getSelectedRecord(role) {
    const source = role === 'query' ? state.query : state.reference;
    if (!source.records.length) {
      return null;
    }
    const index = clampIndex(source.selectedRecordIndex, source.records.length);
    return source.records[index] || null;
  }

  function hasReadyInputs() {
    return Boolean(getSelectedRecord('reference')?.sequence?.length && getSelectedRecord('query')?.sequence?.length);
  }

  function setAlignmentStatus(message, isError = false) {
    state.statusMessage = String(message || '').trim() || 'Idle';
    state.statusIsError = isError === true;
    if (elements.alignmentStatus) {
      elements.alignmentStatus.textContent = state.statusMessage;
      elements.alignmentStatus.style.color = isError ? 'var(--danger)' : '';
    }
  }

  function syncButtons() {
    if (elements.alignmentRunBtn) {
      elements.alignmentRunBtn.disabled = state.isRunning || !hasReadyInputs();
    }
    if (elements.alignmentResetBtn) {
      const hasAnyInput = state.reference.records.length || state.query.records.length || state.result;
      elements.alignmentResetBtn.disabled = !hasAnyInput || state.isRunning;
    }
    if (elements.alignmentReferenceRecordSelect) {
      elements.alignmentReferenceRecordSelect.disabled = state.reference.records.length < 2 || state.isRunning;
    }
    if (elements.alignmentQueryRecordSelect) {
      elements.alignmentQueryRecordSelect.disabled = state.query.records.length < 2 || state.isRunning;
    }
  }

  function renderSource(role) {
    const source = role === 'query' ? state.query : state.reference;
    const fileNameElement = role === 'query' ? elements.alignmentQueryFileName : elements.alignmentReferenceFileName;
    const summaryElement = role === 'query' ? elements.alignmentQuerySummary : elements.alignmentReferenceSummary;
    const statusElement = role === 'query' ? elements.alignmentQueryStatus : elements.alignmentReferenceStatus;
    const recordWrapElement = role === 'query' ? elements.alignmentQueryRecordWrap : elements.alignmentReferenceRecordWrap;
    const recordSelectElement = role === 'query' ? elements.alignmentQueryRecordSelect : elements.alignmentReferenceRecordSelect;

    if (fileNameElement) {
      fileNameElement.textContent = source.fileName || `No ${role} file selected`;
    }

    if (summaryElement) {
      if (!source.records.length) {
        summaryElement.textContent = `No ${role} loaded.`;
      } else {
        summaryElement.textContent = describeSelectedRecord(getSelectedRecord(role));
      }
    }

    if (recordWrapElement) {
      recordWrapElement.hidden = source.records.length < 2;
    }
    if (recordSelectElement) {
      if (source.records.length < 2) {
        recordSelectElement.innerHTML = '<option value="0">Single record</option>';
      } else {
        recordSelectElement.innerHTML = source.records
          .map((record, index) => `
            <option value="${index}"${index === clampIndex(source.selectedRecordIndex, source.records.length) ? ' selected' : ''}>
              ${escapeHtml(`${record.name} (${record.sequence.length.toLocaleString()} bp)`)}
            </option>
          `)
          .join('');
      }
    }

    if (statusElement) {
      if (source.errors.length) {
        statusElement.textContent = source.errors[0];
        statusElement.style.color = 'var(--danger)';
      } else if (source.warnings.length) {
        statusElement.textContent = source.warnings.join(' | ');
        statusElement.style.color = '';
      } else if (source.records.length) {
        statusElement.textContent = `Loaded ${source.records.length} ${source.format.toUpperCase()} record${source.records.length === 1 ? '' : 's'}.`;
        statusElement.style.color = '';
      } else {
        statusElement.textContent = `${role[0].toUpperCase()}${role.slice(1)} parser idle.`;
        statusElement.style.color = '';
      }
    }
  }

  function renderResult() {
    const result = state.result;
    const referenceRecord = getSelectedRecord('reference');

    if (elements.alignmentSummary) {
      elements.alignmentSummary.innerHTML = !result
        ? '<p class="small-note">Run an alignment to inspect orientation, coverage, and differences.</p>'
        : `
          <div class="sequence-viewer-alignment-summary-item">
            <strong>Reference</strong>
            <span>${escapeHtml(result.referenceName || '-')}</span>
          </div>
          <div class="sequence-viewer-alignment-summary-item">
            <strong>Query</strong>
            <span>${escapeHtml(result.queryName || '-')}</span>
          </div>
          <div class="sequence-viewer-alignment-summary-item">
            <strong>Orientation</strong>
            <span>${escapeHtml(result.orientation || '-')}</span>
          </div>
          <div class="sequence-viewer-alignment-summary-item">
            <strong>Identity</strong>
            <span>${escapeHtml(`${Number(result.identityPercent || 0).toFixed(2)}%`)}</span>
          </div>
          <div class="sequence-viewer-alignment-summary-item">
            <strong>Query Coverage</strong>
            <span>${escapeHtml(`${Number(result.queryCoveragePercent || 0).toFixed(2)}%`)}</span>
          </div>
          <div class="sequence-viewer-alignment-summary-item">
            <strong>Reference Span</strong>
            <span>${escapeHtml(formatReferenceSpan(result.referenceSpan, referenceRecord?.sequence?.length || 0))}</span>
          </div>
          <div class="sequence-viewer-alignment-summary-item">
            <strong>Score</strong>
            <span>${escapeHtml(String(result.score || 0))}</span>
          </div>
          <div class="sequence-viewer-alignment-summary-item">
            <strong>Mismatches</strong>
            <span>${escapeHtml(String(result.mismatchCount || 0))}</span>
          </div>
          <div class="sequence-viewer-alignment-summary-item">
            <strong>Insertions / Deletions</strong>
            <span>${escapeHtml(`${Number(result.insertionCount || 0)} / ${Number(result.deletionCount || 0)}`)}</span>
          </div>
        `;
    }

    if (elements.alignmentPretty) {
      elements.alignmentPretty.innerHTML = buildAlignmentPrettyHtml(result);
    }

    if (elements.alignmentDifferences) {
      elements.alignmentDifferences.innerHTML = result
        ? buildDifferenceTableHtml(result, referenceRecord)
        : '<p class="small-note">Mismatch and indel calls will appear here.</p>';
    }
  }

  function render() {
    renderSource('reference');
    renderSource('query');
    renderResult();
    syncButtons();
    setAlignmentStatus(state.statusMessage, state.statusIsError);
  }

  function openSequencingAlignmentWorkspace() {
    setLocalWorkspaceVisibility('alignment');
    if (onNavigateDetail) {
      onNavigateDetail();
    }
    setStatus('Opened sequencing alignment workspace.');
    render();
  }

  function closeSequencingAlignmentWorkspace() {
    setLocalWorkspaceVisibility('detail');
    if (onNavigateDetail) {
      onNavigateDetail();
    }
    setStatus('Returned to sequence detail.');
  }

  async function loadSource(role, input) {
    const label = role === 'query' ? 'query' : 'reference';
    setAlignmentStatus(`Loading ${label} input...`);

    try {
      const parsed = await parseAlignmentInput(role, input, {
        readFileAsText,
        readFileAsArrayBuffer
      });
      const fileName = String(input?.name || input?.fileName || input?.file?.name || '').trim();
      const next = {
        role,
        fileName: fileName || `Loaded ${label}`,
        format: parsed.format,
        records: Array.isArray(parsed.records) ? parsed.records : [],
        warnings: Array.isArray(parsed.warnings) ? parsed.warnings : [],
        errors: Array.isArray(parsed.errors) ? parsed.errors : [],
        selectedRecordIndex: 0
      };

      state[role] = next;
      state.result = null;

      if (next.errors.length) {
        setAlignmentStatus(next.errors[0], true);
      } else if (!next.records.length) {
        setAlignmentStatus(`No ${label} records were loaded.`, true);
      } else {
        setAlignmentStatus(`Loaded ${label} input: ${describeSelectedRecord(next.records[0])}`);
        setStatus(`Loaded sequencing ${label} input.`);
      }
    } catch (error) {
      state[role] = {
        ...createEmptySourceState(role),
        fileName: String(input?.name || input?.fileName || input?.file?.name || '').trim()
      };
      state.result = null;
      setAlignmentStatus(error?.message || `Failed to load ${label} input.`, true);
    }

    render();
    return getSelectedRecord(role);
  }

  async function loadSequencingAlignmentReference(input) {
    return await loadSource('reference', input);
  }

  async function loadSequencingAlignmentQuery(input) {
    return await loadSource('query', input);
  }

  async function runSequencingAlignment() {
    const referenceRecord = getSelectedRecord('reference');
    const queryRecord = getSelectedRecord('query');
    if (!referenceRecord?.sequence?.length || !queryRecord?.sequence?.length) {
      setAlignmentStatus('Load both a reference and a query before running the alignment.', true);
      render();
      return null;
    }

    state.isRunning = true;
    setAlignmentStatus('Running sequencing alignment...');
    render();

    try {
      state.result = alignSequenceToReference(referenceRecord, queryRecord);
      setAlignmentStatus(
        `Best ${state.result.orientation} alignment: ${state.result.identityPercent.toFixed(2)}% identity across ${state.result.queryCoveragePercent.toFixed(2)}% query coverage.`
      );
      setStatus(`Sequencing alignment complete for ${state.result.queryName}.`);
    } catch (error) {
      state.result = null;
      setAlignmentStatus(error?.message || 'Sequencing alignment failed.', true);
    } finally {
      state.isRunning = false;
      render();
    }

    return state.result;
  }

  function resetSequencingAlignment() {
    state.reference = createEmptySourceState('reference');
    state.query = createEmptySourceState('query');
    state.result = null;
    state.isRunning = false;
    state.statusMessage = 'Load a reference and a query to begin.';
    state.statusIsError = false;
    if (elements.alignmentReferenceInput) {
      elements.alignmentReferenceInput.value = '';
    }
    if (elements.alignmentQueryInput) {
      elements.alignmentQueryInput.value = '';
    }
    render();
    setStatus('Reset sequencing alignment inputs.');
  }

  function bindEvents() {
    elements.alignmentReferenceChooseBtn?.addEventListener('click', () => {
      elements.alignmentReferenceInput?.click?.();
    });
    elements.alignmentQueryChooseBtn?.addEventListener('click', () => {
      elements.alignmentQueryInput?.click?.();
    });

    elements.alignmentReferenceInput?.addEventListener('change', async () => {
      const file = elements.alignmentReferenceInput.files?.[0];
      if (!file) {
        return;
      }
      try {
        await loadSequencingAlignmentReference(file);
      } finally {
        elements.alignmentReferenceInput.value = '';
      }
    });

    elements.alignmentQueryInput?.addEventListener('change', async () => {
      const file = elements.alignmentQueryInput.files?.[0];
      if (!file) {
        return;
      }
      try {
        await loadSequencingAlignmentQuery(file);
      } finally {
        elements.alignmentQueryInput.value = '';
      }
    });

    elements.alignmentReferenceRecordSelect?.addEventListener('change', () => {
      state.reference.selectedRecordIndex = clampIndex(
        Number(elements.alignmentReferenceRecordSelect.value),
        state.reference.records.length
      );
      state.result = null;
      setAlignmentStatus(`Selected reference record: ${getSelectedRecord('reference')?.name || '-'}`);
      render();
    });

    elements.alignmentQueryRecordSelect?.addEventListener('change', () => {
      state.query.selectedRecordIndex = clampIndex(
        Number(elements.alignmentQueryRecordSelect.value),
        state.query.records.length
      );
      state.result = null;
      setAlignmentStatus(`Selected query record: ${getSelectedRecord('query')?.name || '-'}`);
      render();
    });

    elements.alignmentRunBtn?.addEventListener('click', () => {
      void runSequencingAlignment();
    });

    elements.alignmentResetBtn?.addEventListener('click', () => {
      resetSequencingAlignment();
    });

    elements.alignmentCloseBtn?.addEventListener('click', () => {
      closeSequencingAlignmentWorkspace();
    });
  }

  return {
    bindEvents,
    render,
    openSequencingAlignmentWorkspace,
    closeSequencingAlignmentWorkspace,
    loadSequencingAlignmentReference,
    loadSequencingAlignmentQuery,
    runSequencingAlignment,
    resetSequencingAlignment
  };
}
