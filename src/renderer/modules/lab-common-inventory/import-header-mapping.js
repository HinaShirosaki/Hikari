import { CHEMICAL_IMPORT_FIELDS, normalizeImportFieldKey, normalizeImportHeader } from './import-schema.js';
import { guessChemicalImportField } from './import-field-guessing.js';
import { parseJsonFromText } from '../../lib/json.js';
import { requestDirectLlm } from '../../services/direct-llm.js';
export function installImportHeaderMapping(ctx) {
  const { state } = ctx;
function mapChemicalImportHeadersLocally(headers) {
  const fieldToColumn = {};
  const columnToField = {};
  const decisions = [];
  const unmappedHeaders = [];
  headers.forEach((header, index) => {
    const cleanHeader = String(header || '').trim();
    if (!cleanHeader) {
      return;
    }
    const field = guessChemicalImportField(cleanHeader);
    if (field && fieldToColumn[field] == null) {
      fieldToColumn[field] = index;
      columnToField[index] = field;
      decisions.push({
        header: cleanHeader,
        field,
        source: 'local'
      });
      return;
    }
    unmappedHeaders.push(cleanHeader);
  });
  return {
    fieldToColumn,
    columnToField,
    decisions,
    unmappedHeaders,
    usedLlm: false,
    llmError: ''
  };
}
function buildLlmHeaderPrompt(headers, rows, localInference) {
  const previewRows = rows.slice(0, 5).map((row) => {
    const entry = {};
    headers.forEach((header, index) => {
      entry[String(header || `Column ${index + 1}`).trim() || `Column ${index + 1}`] = String(row[index] ?? '').trim();
    });
    return entry;
  });
  const fields = CHEMICAL_IMPORT_FIELDS.map((field) => ({
    key: field.key,
    label: field.label,
    description: field.description
  }));
  return [
    'Map spreadsheet column headers into this chemical inventory schema.',
    'Return only JSON with this shape: {"mapping":{"Source Header":"fieldKey or ignore"},"notes":"short"}',
    'Use "ignore" for columns that do not fit. Important example: "position" should map to "location" when it means storage position.',
    `Allowed field keys: ${CHEMICAL_IMPORT_FIELDS.map((field) => field.key).join(', ')}`,
    '',
    `Schema: ${JSON.stringify(fields)}`,
    `Headers: ${JSON.stringify(headers)}`,
    `Local mapping already found: ${JSON.stringify(localInference.decisions)}`,
    `Preview rows: ${JSON.stringify(previewRows)}`
  ].join('\n');
}
async function requestLlmChemicalHeaderMapping(headers, rows, localInference) {
  const prompt = buildLlmHeaderPrompt(headers, rows, localInference);
  const result = await requestDirectLlm({
    moduleId: 'inventory',
    task: 'chemical-header-mapping',
    prompt,
    expectJson: true,
    llm: state.settings?.llm
  });
  return result.payload && typeof result.payload === 'object'
    ? result.payload
    : parseJsonFromText(result.text);
}
function findHeaderIndex(headers, headerName) {
  const normalized = normalizeImportHeader(headerName);
  return headers.findIndex((header) => normalizeImportHeader(header) === normalized);
}
function applyLlmHeaderMapping(headers, inference, llmPayload) {
  const rawMapping = llmPayload?.mapping && typeof llmPayload.mapping === 'object'
    ? llmPayload.mapping
    : (llmPayload && typeof llmPayload === 'object' ? llmPayload : {});
  Object.entries(rawMapping).forEach(([headerName, fieldName]) => {
    let headerIndex = findHeaderIndex(headers, headerName);
    let field = normalizeImportFieldKey(fieldName);
    if (headerIndex < 0) {
      const keyAsField = normalizeImportFieldKey(headerName);
      const valueAsHeaderIndex = findHeaderIndex(headers, fieldName);
      if (keyAsField && valueAsHeaderIndex >= 0) {
        headerIndex = valueAsHeaderIndex;
        field = keyAsField;
      }
    }
    if (headerIndex < 0 || !field || field === 'ignore') {
      return;
    }
    if (inference.fieldToColumn[field] != null || inference.columnToField[headerIndex]) {
      return;
    }
    inference.fieldToColumn[field] = headerIndex;
    inference.columnToField[headerIndex] = field;
    inference.decisions.push({
      header: String(headers[headerIndex] || '').trim(),
      field,
      source: 'llm'
    });
  });
  inference.unmappedHeaders = headers.filter((header, index) => {
    return String(header || '').trim() && !inference.columnToField[index];
  });
  inference.usedLlm = true;
  return inference;
}
async function inferChemicalImportHeaders(headers, rows) {
  const cleanHeaders = headers.map((header, index) => String(header || `Column ${index + 1}`).trim() || `Column ${index + 1}`);
  const inference = mapChemicalImportHeadersLocally(cleanHeaders);
  const needsLlm = inference.unmappedHeaders.length > 0
    || inference.fieldToColumn.name == null
    || inference.fieldToColumn.location == null;
  if (!needsLlm) {
    return inference;
  }
  try {
    const llmPayload = await requestLlmChemicalHeaderMapping(cleanHeaders, rows, inference);
    if (llmPayload) {
      applyLlmHeaderMapping(cleanHeaders, inference, llmPayload);
    }
  } catch (error) {
    inference.llmError = String(error?.message || error);
  }
  return inference;
}
  Object.assign(ctx, {
    mapChemicalImportHeadersLocally,
    buildLlmHeaderPrompt,
    requestLlmChemicalHeaderMapping,
    findHeaderIndex,
    applyLlmHeaderMapping,
    inferChemicalImportHeaders
  });
}
