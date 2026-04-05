import { exportProtocolPdf } from './pdf-export.js';
import { requestLlmText } from './papers/llm.js';
import { parseJsonFromText } from './papers/normalizers.js';

export function initProtocolManagement({
  state,
  persist,
  createId,
  safeText,
  onProtocolsChanged,
  trackGrowthEvent
}) {
  const PLACEHOLDER_TOKEN_REGEX = /\{\{ph:([^}]+)\}\}/g;
  const PROTOCOL_SHARE_LINK_PREFIX = 'enana://protocol-share/';

  const protocolListPanel = document.getElementById('protocol-list-panel');
  const protocolDetailPanel = document.getElementById('protocol-detail-panel');
  const protocolEmptyPanel = document.getElementById('protocol-empty-panel');
  const protocolEditorPanel = document.getElementById('protocol-editor-panel');
  const protocolViewPanel = document.getElementById('protocol-view-panel');

  const createProtocolBtn = document.getElementById('create-protocol-btn');
  const emptyCreateProtocolBtn = document.querySelector?.('[data-protocol-empty-create]') || null;
  const protocolEditorBackBtn = document.getElementById('protocol-editor-back-btn');
  const protocolCancelBtn = document.getElementById('protocol-cancel-btn');
  const protocolViewBackBtn = document.getElementById('protocol-view-back-btn');
  const protocolExportPdfBtn = document.getElementById('protocol-export-pdf-btn');

  const protocolEditorHeading = document.getElementById('protocol-editor-heading');
  const protocolViewTitle = document.getElementById('protocol-view-title');
  const protocolViewContent = document.getElementById('protocol-view-content');

  const protocolForm = document.getElementById('protocol-form');
  const protocolJsonImportPanel = document.getElementById('protocol-json-import-panel');
  const protocolNameInput = document.getElementById('protocol-name');
  const protocolPurposeInput = document.getElementById('protocol-purpose');
  const protocolMaterialsInput = document.getElementById('protocol-materials');
  const protocolStepsInput = document.getElementById('protocol-steps');
  const protocolTroubleshootingInput = document.getElementById('protocol-troubleshooting');
  const protocolPolishBtn = document.getElementById('protocol-polish-btn');
  const protocolPolishOverlay = document.getElementById('protocol-polish-overlay');
  const protocolPolishCloseBtn = document.getElementById('protocol-polish-close-btn');
  const protocolPolishKeepEditingBtn = document.getElementById('protocol-polish-keep-editing-btn');
  const protocolPolishApplyBtn = document.getElementById('protocol-polish-apply-btn');
  const protocolPolishOriginalPreview = document.getElementById('protocol-polish-original-preview');
  const protocolPolishResultPreview = document.getElementById('protocol-polish-result-preview');
  const protocolPolishStatus = document.getElementById('protocol-polish-status');

  const addPlaceholderBtn = document.getElementById('add-placeholder-btn');
  const placeholderNameInput = document.getElementById('placeholder-name');
  const placeholderPresetButtons = [...(document.querySelectorAll?.('[data-protocol-placeholder-preset]') || [])];

  const protocolShareStatus = document.getElementById('protocol-share-status');
  const protocolShareLinkPanel = document.getElementById('protocol-share-link-panel');
  const protocolShareLinkOutput = document.getElementById('protocol-share-link-output');
  const protocolList = document.getElementById('protocol-list');
  const protocolSortFieldBtn = document.getElementById('protocol-sort-field-btn');
  const protocolSortOrderBtn = document.getElementById('protocol-sort-order-btn');
  const protocolJsonImportFileInput = document.getElementById('protocol-json-import-file');
  const protocolJsonImportInput = document.getElementById('protocol-json-import-input');
  const importProtocolJsonBtn = document.getElementById('import-protocol-json-btn');
  const protocolJsonImportStatus = document.getElementById('protocol-json-import-status');

  const defaultShareStatus = 'Click Share on a protocol to send it to a teammate or copy a portable share link.';
  const defaultProtocolJsonImportStatus = 'Import one or more protocols from JSON.';

  let currentProtocolDraft = createEmptyDraft();
  let activeMenuProtocolId = '';
  let activeShareProtocolId = '';
  let activeShareTargetEmail = '';
  let protocolSortField = 'time';
  let protocolSortOrder = 'asc';
  let activeProtocolId = '';
  let protocolDetailMode = 'empty';
  let isCreateEditorMode = true;
  let polishedProtocolDraft = null;
  let protocolPolishSourceDraft = null;
  let protocolPolishRequestToken = 0;
  let isProtocolPolishPending = false;

  createProtocolBtn?.addEventListener('click', onCreateProtocol);
  emptyCreateProtocolBtn?.addEventListener('click', onCreateProtocol);
  protocolEditorBackBtn?.addEventListener('click', () => showEmptyPanel({ resetEditor: true }));
  protocolCancelBtn?.addEventListener('click', onCancelEditor);
  protocolViewBackBtn?.addEventListener('click', () => showEmptyPanel({ resetEditor: false }));
  protocolPolishBtn?.addEventListener('click', () => {
    void onPolishProtocol();
  });
  protocolPolishCloseBtn?.addEventListener('click', closeProtocolPolishOverlay);
  protocolPolishKeepEditingBtn?.addEventListener('click', closeProtocolPolishOverlay);
  protocolPolishApplyBtn?.addEventListener('click', applyPolishedProtocolToEditor);
  protocolPolishOverlay?.addEventListener('click', (event) => {
    if (event.target === protocolPolishOverlay) {
      closeProtocolPolishOverlay();
    }
  });

  protocolForm?.addEventListener('submit', onProtocolSubmit);
  protocolMaterialsInput?.addEventListener('focus', () => ensureLeadingBullet(protocolMaterialsInput));
  protocolMaterialsInput?.addEventListener('keydown', onBulletTextareaKeydown);
  protocolMaterialsInput?.addEventListener('blur', () => normalizeBulletTextarea(protocolMaterialsInput));
  protocolStepsInput?.addEventListener('focus', () => ensureLeadingBullet(protocolStepsInput));
  protocolStepsInput?.addEventListener('keydown', onBulletTextareaKeydown);
  protocolStepsInput?.addEventListener('blur', () => normalizeBulletTextarea(protocolStepsInput));
  addPlaceholderBtn?.addEventListener('click', addInteractivePlaceholderToken);
  placeholderPresetButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const placeholder = String(button.dataset.protocolPlaceholderPreset || '').trim();
      if (!placeholder) {
        return;
      }
      addInteractivePlaceholderToken(placeholder);
    });
  });
  protocolSortFieldBtn?.addEventListener('click', () => {
    protocolSortField = protocolSortField === 'time' ? 'name' : 'time';
    updateSortButtonLabels();
    renderList();
  });
  protocolSortOrderBtn?.addEventListener('click', () => {
    protocolSortOrder = protocolSortOrder === 'asc' ? 'desc' : 'asc';
    updateSortButtonLabels();
    renderList();
  });
  protocolExportPdfBtn?.addEventListener('click', onExportViewedProtocolPdf);
  importProtocolJsonBtn?.addEventListener('click', onImportProtocolJson);

  setShareStatus(defaultShareStatus);
  if (protocolJsonImportStatus && !String(protocolJsonImportStatus.textContent || '').trim()) {
    protocolJsonImportStatus.textContent = defaultProtocolJsonImportStatus;
  }
  updateSortButtonLabels();
  applyDetailMode('empty');

  document.addEventListener?.('click', (event) => {
    if (!activeMenuProtocolId) {
      return;
    }
    const target = event.target;
    const hasNode = typeof Node !== 'undefined';
    const hasElement = typeof Element !== 'undefined';
    if (hasNode && target instanceof Node && protocolList?.contains?.(target)) {
      const trigger = hasElement && target instanceof Element
        ? target.closest('[data-protocol-menu-trigger], .protocol-action-menu')
        : null;
      if (trigger) {
        return;
      }
    }
    activeMenuProtocolId = '';
    renderList();
  });
  document.addEventListener?.('keydown', (event) => {
    if (event.key === 'Escape' && protocolPolishOverlay && !protocolPolishOverlay.hidden) {
      closeProtocolPolishOverlay();
      return;
    }
    if (event.key === 'Escape' && activeMenuProtocolId) {
      activeMenuProtocolId = '';
      renderList();
    }
  });

  function createEmptyDraft() {
    return {
      id: null,
      name: '',
      purpose: '',
      materials: [],
      steps: [],
      troubleshooting: '',
      createdAt: '',
      updatedAt: ''
    };
  }

  function normalizeIsoTimestamp(rawValue, fallback = '') {
    const candidate = String(rawValue || '').trim();
    if (!candidate) {
      return fallback;
    }

    const timestamp = Date.parse(candidate);
    if (!Number.isFinite(timestamp)) {
      return fallback;
    }

    return new Date(timestamp).toISOString();
  }

  function parseTimestamp(rawValue) {
    const timestamp = Date.parse(String(rawValue || '').trim());
    return Number.isFinite(timestamp) ? timestamp : 0;
  }

  function stripBulletPrefix(rawLine) {
    return String(rawLine || '')
      .replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '')
      .trim();
  }

  function splitTextLines(rawText) {
    return String(rawText || '').replace(/\r\n?/g, '\n').split('\n');
  }

  function parseBulletLines(rawText) {
    return splitTextLines(rawText)
      .map((line) => stripBulletPrefix(line))
      .filter(Boolean);
  }

  function formatBulletLines(lines) {
    const values = Array.isArray(lines) ? lines : [];
    return values
      .map((line) => String(line || '').trim())
      .filter(Boolean)
      .map((line) => `• ${line}`)
      .join('\n');
  }

  function buildDraftFromEditorInputs() {
    const nowIso = new Date().toISOString();
    return {
      id: currentProtocolDraft.id || null,
      name: String(protocolNameInput?.value || '').trim(),
      purpose: String(protocolPurposeInput?.value || '').trim(),
      materials: parseBulletLines(protocolMaterialsInput?.value || ''),
      steps: buildStepEntriesFromText(protocolStepsInput?.value || '', currentProtocolDraft.steps)
        .map((entry) => cloneStep(entry.step)),
      troubleshooting: String(protocolTroubleshootingInput?.value || '').trim(),
      createdAt: normalizeIsoTimestamp(currentProtocolDraft.createdAt, nowIso),
      updatedAt: normalizeIsoTimestamp(currentProtocolDraft.updatedAt, currentProtocolDraft.createdAt || nowIso)
    };
  }

  function ensureLeadingBullet(textarea) {
    if (!textarea) {
      return;
    }
    if (String(textarea.value || '').trim()) {
      return;
    }
    textarea.value = '• ';
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  }

  function normalizeBulletTextarea(textarea) {
    if (!textarea) {
      return;
    }
    const normalized = parseBulletLines(textarea.value);
    textarea.value = normalized.length ? formatBulletLines(normalized) : '';
  }

  function insertTextAtCursor(input, text) {
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? input.value.length;
    const before = input.value.slice(0, start);
    const after = input.value.slice(end);
    input.value = `${before}${text}${after}`;
    const nextPos = start + text.length;
    input.setSelectionRange(nextPos, nextPos);
    input.focus();
  }

  function onBulletTextareaKeydown(event) {
    if (event.key !== 'Enter') {
      return;
    }
    event.preventDefault();
    insertTextAtCursor(event.currentTarget, '\n• ');
  }

  function normalizeLineForMatching(rawLine) {
    return stripBulletPrefix(rawLine)
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  function normalizeMaterials(rawMaterials) {
    if (Array.isArray(rawMaterials)) {
      return rawMaterials.map((item) => String(item || '').trim()).filter(Boolean);
    }

    const value = String(rawMaterials || '').trim();
    if (!value) {
      return [];
    }

    return parseBulletLines(value);
  }

  function getStepText(step) {
    if (typeof step === 'string') {
      return step.trim();
    }
    return String(step?.text || step?.instruction || '').trim();
  }

  function cloneStep(step) {
    const stepText = getStepText(step);
    return {
      id: String(step?.id || createId()),
      text: stepText,
      placeholders: Array.isArray(step?.placeholders)
        ? step.placeholders
          .filter((item) => item && typeof item === 'object')
          .map((item) => ({ id: String(item.id || createId()), name: String(item.name || '').trim() }))
          .filter((item) => item.name)
        : []
    };
  }

  function cloneDraftFromProtocol(protocol) {
    const createdAt = normalizeIsoTimestamp(protocol?.createdAt);
    const updatedAt = normalizeIsoTimestamp(protocol?.updatedAt, createdAt);
    return {
      id: protocol?.id || null,
      name: String(protocol?.name || '').trim(),
      purpose: String(protocol?.purpose || '').trim(),
      materials: normalizeMaterials(protocol?.materials),
      steps: Array.isArray(protocol?.steps) ? protocol.steps.map((step) => cloneStep(step)) : [],
      troubleshooting: String(protocol?.troubleshooting || '').trim(),
      createdAt,
      updatedAt
    };
  }

  function stepToEditableLine(step) {
    const source = getStepText(step);
    const placeholders = Array.isArray(step?.placeholders) ? step.placeholders : [];
    const matches = [...source.matchAll(PLACEHOLDER_TOKEN_REGEX)];

    if (!matches.length) {
      if (!placeholders.length) {
        return source.trim();
      }
      const trailing = placeholders
        .map((placeholder) => String(placeholder?.name || '').trim())
        .filter(Boolean)
        .map((name) => `[${name}]`)
        .join(' ');
      return `${source} ${trailing}`.trim();
    }

    let cursor = 0;
    let line = '';

    matches.forEach((match) => {
      const index = Number(match.index || 0);
      const placeholderId = String(match[1] || '');
      const placeholder = placeholders.find((item) => String(item.id) === placeholderId);
      line += source.slice(cursor, index);
      line += `[${placeholder?.name || 'value'}]`;
      cursor = index + match[0].length;
    });

    line += source.slice(cursor);
    return line.trim();
  }

  function formatStepLines(steps) {
    const values = Array.isArray(steps) ? steps : [];
    return values
      .map((step) => stepToEditableLine(step))
      .filter(Boolean)
      .map((line) => `• ${line}`)
      .join('\n');
  }

  function extractPlaceholdersFromText(rawText) {
    const placeholders = [];
    const cleaned = String(rawText || '')
      .replace(/\[([^[\]]*)\]/g, (_, name) => {
        const trimmed = String(name || '').trim() || 'value';
        const id = createId();
        placeholders.push({ id, name: trimmed });
        return `{{ph:${id}}}`;
      })
      .replace(/\s+/g, ' ')
      .trim();

    return { cleanedText: cleaned, placeholders };
  }

  function normalizeTroubleshooting(rawTroubleshooting) {
    if (Array.isArray(rawTroubleshooting)) {
      return rawTroubleshooting
        .filter((item) => item && typeof item === 'object')
        .map((item) => {
          const problem = String(item.problem || '').trim();
          const possibleCause = String(item.possible_cause || item.possibleCause || '').trim();
          const solution = String(item.solution || '').trim();
          const parts = [];
          if (problem) {
            parts.push(`Problem: ${problem}`);
          }
          if (possibleCause) {
            parts.push(`Possible cause: ${possibleCause}`);
          }
          if (solution) {
            parts.push(`Solution: ${solution}`);
          }
          return parts.join('; ');
        })
        .filter(Boolean)
        .join('\n');
    }
    return String(rawTroubleshooting || '').trim();
  }

  function normalizeMethodStepEntries(rawSteps) {
    if (!Array.isArray(rawSteps)) {
      return [];
    }

    const sortedSteps = rawSteps
      .map((step, index) => ({ step, index }))
      .sort((a, b) => {
        const numberA = Number(a.step?.step_number);
        const numberB = Number(b.step?.step_number);
        const hasNumberA = Number.isFinite(numberA);
        const hasNumberB = Number.isFinite(numberB);
        if (hasNumberA && hasNumberB && numberA !== numberB) {
          return numberA - numberB;
        }
        if (hasNumberA !== hasNumberB) {
          return hasNumberA ? -1 : 1;
        }
        return a.index - b.index;
      })
      .map((entry) => entry.step);

    return sortedSteps
      .map((rawStep) => {
        if (typeof rawStep === 'string') {
          return String(rawStep || '').trim();
        }
        if (!rawStep || typeof rawStep !== 'object') {
          return '';
        }
        return String(rawStep.action || rawStep.text || rawStep.instruction || '').trim();
      })
      .filter(Boolean)
      .map((text) => {
        const parsed = extractPlaceholdersFromText(text);
        return {
          id: createId(),
          text: parsed.cleanedText || text,
          placeholders: parsed.placeholders
        };
      });
  }

  function normalizeImportedProtocolStepEntries(rawSteps) {
    if (!Array.isArray(rawSteps)) {
      return [];
    }

    const sortedSteps = rawSteps
      .map((step, index) => ({ step, index }))
      .filter((entry) => entry.step != null)
      .sort((a, b) => {
        const numberA = Number(a.step?.step_number);
        const numberB = Number(b.step?.step_number);
        const hasNumberA = Number.isFinite(numberA);
        const hasNumberB = Number.isFinite(numberB);
        if (hasNumberA && hasNumberB && numberA !== numberB) {
          return numberA - numberB;
        }
        if (hasNumberA !== hasNumberB) {
          return hasNumberA ? -1 : 1;
        }
        return a.index - b.index;
      })
      .map((entry) => entry.step);

    return sortedSteps
      .map((rawStep) => {
        if (typeof rawStep === 'string') {
          const rawText = String(rawStep || '').trim();
          if (!rawText) {
            return null;
          }
          const parsed = extractPlaceholdersFromText(rawText);
          return {
            id: createId(),
            text: parsed.cleanedText || rawText,
            placeholders: parsed.placeholders
          };
        }
        if (!rawStep || typeof rawStep !== 'object') {
          return null;
        }

        const rawText = String(rawStep.text || rawStep.action || rawStep.instruction || '').trim();
        if (!rawText) {
          return null;
        }

        const placeholders = Array.isArray(rawStep.placeholders)
          ? rawStep.placeholders
            .filter((item) => item && typeof item === 'object')
            .map((item) => ({ id: String(item.id || createId()), name: String(item.name || '').trim() }))
            .filter((item) => item.name)
          : [];

        if (placeholders.length) {
          return {
            id: String(rawStep.id || createId()),
            text: rawText,
            placeholders
          };
        }

        const parsed = extractPlaceholdersFromText(rawText);
        return {
          id: String(rawStep.id || createId()),
          text: parsed.cleanedText || rawText,
          placeholders: parsed.placeholders
        };
      })
      .filter(Boolean);
  }

  function sanitizeIncomingProtocol(rawProtocol) {
    if (!rawProtocol || typeof rawProtocol !== 'object') {
      return null;
    }

    const name = String(rawProtocol.name || rawProtocol.title || '').trim();
    if (!name) {
      return null;
    }

    const nowIso = new Date().toISOString();
    const parsedCreatedAt = Date.parse(String(rawProtocol.createdAt || '').trim());
    const createdAt = Number.isFinite(parsedCreatedAt) ? new Date(parsedCreatedAt).toISOString() : nowIso;
    const parsedUpdatedAt = Date.parse(String(rawProtocol.updatedAt || '').trim());
    const updatedAt = Number.isFinite(parsedUpdatedAt) ? new Date(parsedUpdatedAt).toISOString() : createdAt;

    return {
      id: String(rawProtocol.id || createId()),
      name,
      createdAt,
      updatedAt,
      purpose: String(rawProtocol.purpose || '').trim(),
      materials: normalizeMaterials(rawProtocol.materials),
      steps: normalizeImportedProtocolStepEntries(rawProtocol.steps || rawProtocol.procedure),
      troubleshooting: normalizeTroubleshooting(rawProtocol.troubleshooting)
    };
  }

  function sanitizeIncomingProtocols(rawProtocols) {
    if (Array.isArray(rawProtocols)) {
      return rawProtocols.map((item) => sanitizeIncomingProtocol(item)).filter(Boolean);
    }
    const single = sanitizeIncomingProtocol(rawProtocols);
    return single ? [single] : [];
  }

  function parseLooseJsonObjectOrArray(rawInput) {
    const text = String(rawInput || '').trim();
    if (!text) {
      return null;
    }

    const candidates = [text];
    const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenceMatch?.[1]) {
      candidates.push(String(fenceMatch[1]).trim());
    }

    const firstBrace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      candidates.push(text.slice(firstBrace, lastBrace + 1));
    }

    const firstBracket = text.indexOf('[');
    const lastBracket = text.lastIndexOf(']');
    if (firstBracket >= 0 && lastBracket > firstBracket) {
      candidates.push(text.slice(firstBracket, lastBracket + 1));
    }

    for (const candidate of candidates) {
      try {
        const parsed = JSON.parse(candidate);
        if (Array.isArray(parsed) || (parsed && typeof parsed === 'object')) {
          return parsed;
        }
      } catch {
        // Try next candidate.
      }
    }
    return null;
  }

  function parseProtocolsFromJson(rawInput) {
    const parsed = parseLooseJsonObjectOrArray(rawInput);
    if (!parsed) {
      return [];
    }

    if (Array.isArray(parsed)) {
      return sanitizeIncomingProtocols(parsed);
    }
    if (Array.isArray(parsed.protocols)) {
      return sanitizeIncomingProtocols(parsed.protocols);
    }
    if (parsed.protocol && typeof parsed.protocol === 'object') {
      return sanitizeIncomingProtocols(parsed.protocol);
    }
    if (parsed.type === 'protocol_share_link') {
      return sanitizeIncomingProtocols(parsed.protocol || parsed.protocols);
    }
    return sanitizeIncomingProtocols(parsed);
  }

  function buildUniqueImportedProtocolName(baseName) {
    const takenNames = new Set(
      state.protocols
        .map((item) => String(item?.name || '').trim().toLowerCase())
        .filter(Boolean)
    );

    const resolvedBaseName = String(baseName || '').trim() || 'Imported Protocol';
    let candidate = resolvedBaseName;
    let suffix = 2;
    while (takenNames.has(candidate.toLowerCase())) {
      candidate = `${resolvedBaseName} ${suffix}`;
      suffix += 1;
    }
    return candidate;
  }

  function addImportedProtocol(incoming, copySuffixLabel = 'Imported Copy') {
    const idConflict = state.protocols.some((item) => String(item?.id || '') === String(incoming.id || ''));
    const nameConflict = state.protocols.some(
      (item) => String(item?.name || '').trim().toLowerCase() === String(incoming.name || '').trim().toLowerCase()
    );

    if (!idConflict && !nameConflict) {
      state.protocols.push(incoming);
      return incoming;
    }

    const suffixedName = `${incoming.name} (${String(copySuffixLabel || 'Imported Copy').trim() || 'Imported Copy'})`;
    const imported = {
      ...incoming,
      id: createId(),
      name: buildUniqueImportedProtocolName(suffixedName)
    };
    state.protocols.push(imported);
    return imported;
  }

  async function readTextFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('Failed to read selected JSON file.'));
      reader.readAsText(file);
    });
  }

  async function readProtocolJsonImportInput() {
    const directText = String(protocolJsonImportInput?.value || '').trim();
    if (directText) {
      return directText;
    }
    const file = protocolJsonImportFileInput?.files?.[0];
    if (!file) {
      return '';
    }
    return readTextFile(file);
  }

  function setProtocolJsonImportStatus(message) {
    if (!protocolJsonImportStatus) {
      return;
    }
    protocolJsonImportStatus.textContent = String(message || '').trim() || defaultProtocolJsonImportStatus;
  }

  function resetProtocolJsonImportUi() {
    if (protocolJsonImportInput) {
      protocolJsonImportInput.value = '';
    }
    if (protocolJsonImportFileInput) {
      protocolJsonImportFileInput.value = '';
    }
    setProtocolJsonImportStatus(defaultProtocolJsonImportStatus);
  }

  function syncProtocolImportPanelVisibility() {
    if (!protocolJsonImportPanel) {
      return;
    }
    protocolJsonImportPanel.hidden = !isCreateEditorMode;
  }

  function importProtocolsFromJson(rawInput, options = {}) {
    const incomingProtocols = parseProtocolsFromJson(rawInput);
    if (!incomingProtocols.length) {
      return {
        ok: false,
        error: 'Invalid protocol JSON payload. Use a protocol object, {"protocols":[...]}, or a protocol array.'
      };
    }

    const copySuffixLabel = String(options.copySuffixLabel || 'Imported Copy').trim() || 'Imported Copy';
    const importedProtocols = incomingProtocols.map((incoming) => addImportedProtocol(incoming, copySuffixLabel));
    persist();
    if (options.notifyChanged !== false) {
      onProtocolsChanged?.();
    }
    if (options.renderList !== false) {
      renderList();
    }
    return {
      ok: true,
      importedProtocols
    };
  }

  async function onImportProtocolJson() {
    let rawInput = '';
    try {
      rawInput = await readProtocolJsonImportInput();
    } catch (error) {
      setProtocolJsonImportStatus(String(error?.message || error || 'Failed to read JSON input.'));
      return;
    }

    if (!String(rawInput || '').trim()) {
      setProtocolJsonImportStatus('Paste protocol JSON or choose a JSON file first.');
      return;
    }

    const result = importProtocolsFromJson(rawInput, { copySuffixLabel: 'Imported Copy' });
    if (!result.ok) {
      setProtocolJsonImportStatus(result.error || 'Failed to import protocol JSON.');
      return;
    }

    if (protocolJsonImportInput) {
      protocolJsonImportInput.value = '';
    }
    if (protocolJsonImportFileInput) {
      protocolJsonImportFileInput.value = '';
    }

    if (result.importedProtocols.length === 1) {
      setProtocolJsonImportStatus(`Imported "${result.importedProtocols[0].name}".`);
      return;
    }
    setProtocolJsonImportStatus(`Imported ${result.importedProtocols.length} protocols.`);
  }

  function buildStepEntriesFromText(rawText, existingSteps = []) {
    const buckets = new Map();

    (Array.isArray(existingSteps) ? existingSteps : []).forEach((step) => {
      const key = normalizeLineForMatching(stepToEditableLine(step));
      if (!key) {
        return;
      }
      if (!buckets.has(key)) {
        buckets.set(key, []);
      }
      buckets.get(key).push(cloneStep(step));
    });

    const entries = [];
    splitTextLines(rawText).forEach((rawLine, lineIndex) => {
      const cleanedLine = stripBulletPrefix(rawLine);
      if (!cleanedLine) {
        return;
      }

      const key = normalizeLineForMatching(cleanedLine);
      const queue = buckets.get(key);

      let step = null;
      if (queue && queue.length) {
        step = queue.shift();
      }

      if (!step) {
        const parsed = extractPlaceholdersFromText(cleanedLine);
        step = {
          id: createId(),
          text: parsed.cleanedText || cleanedLine,
          placeholders: parsed.placeholders
        };
      }

      entries.push({ lineIndex, step });
    });

    return entries;
  }

  function insertTokenAtCursor(input, token) {
    insertTextAtCursor(input, token);
  }

  function setShareStatus(message) {
    if (!protocolShareStatus) {
      return;
    }
    const normalized = String(message || '').trim();
    protocolShareStatus.textContent = normalized;
    protocolShareStatus.hidden = !normalized || normalized === defaultShareStatus;
  }

  function setShareLinkOutput(link = '', options = {}) {
    if (!protocolShareLinkPanel || !protocolShareLinkOutput) {
      return;
    }

    const normalizedLink = String(link || '').trim();
    if (!normalizedLink) {
      protocolShareLinkOutput.value = '';
      protocolShareLinkPanel.hidden = true;
      return;
    }

    protocolShareLinkPanel.hidden = false;
    protocolShareLinkOutput.value = normalizedLink;

    if (options.selectText !== false) {
      protocolShareLinkOutput.focus();
      protocolShareLinkOutput.setSelectionRange(0, normalizedLink.length);
    }
  }

  function resolveSenderEmail() {
    const personal = String(state.settings?.personalInfo?.enanaEmail || '').trim();
    if (personal) {
      return personal;
    }
    const firstMemberEmail = state.members
      .map((member) => String(member.enanaEmail || '').trim())
      .find(Boolean);
    return firstMemberEmail || 'system@enana.local';
  }

  function getShareTargetEmails() {
    return Array.from(new Set(
      state.members
        .map((member) => String(member.enanaEmail || '').trim())
        .filter(Boolean)
    ));
  }

  function renderShareTargets() {
    if (protocolShareStatus && !String(protocolShareStatus.textContent || '').trim()) {
      setShareStatus(defaultShareStatus);
    }
  }

  function updateSortButtonLabels() {
    if (protocolSortFieldBtn) {
      protocolSortFieldBtn.textContent = `Sort: ${protocolSortField === 'time' ? 'Time' : 'Name'}`;
    }
    if (protocolSortOrderBtn) {
      protocolSortOrderBtn.textContent = `Order: ${protocolSortOrder === 'asc' ? 'Low to High' : 'High to Low'}`;
    }
  }

  function ensureProtocolTimestamps() {
    if (!Array.isArray(state.protocols) || !state.protocols.length) {
      return;
    }

    const fallbackBaseTimestamp = Date.now() - (state.protocols.length * 1000);
    let changed = false;

    state.protocols = state.protocols.map((protocol, index) => {
      const fallbackCreatedAt = new Date(fallbackBaseTimestamp + (index * 1000)).toISOString();
      const createdAt = normalizeIsoTimestamp(protocol?.createdAt, fallbackCreatedAt);
      const updatedAt = normalizeIsoTimestamp(protocol?.updatedAt, createdAt);
      const rawCreatedAt = String(protocol?.createdAt || '').trim();
      const rawUpdatedAt = String(protocol?.updatedAt || '').trim();

      if (createdAt !== rawCreatedAt || updatedAt !== rawUpdatedAt) {
        changed = true;
      }

      return {
        ...protocol,
        createdAt,
        updatedAt
      };
    });

    if (changed) {
      persist();
    }
  }

  function getProtocolSortTimestamp(protocol) {
    const updatedAt = parseTimestamp(protocol?.updatedAt);
    if (updatedAt) {
      return updatedAt;
    }
    return parseTimestamp(protocol?.createdAt);
  }

  function compareProtocols(a, b) {
    const nameA = String(a?.name || '').trim();
    const nameB = String(b?.name || '').trim();
    const nameResult = nameA.localeCompare(nameB, undefined, { sensitivity: 'base', numeric: true });
    const timeResult = getProtocolSortTimestamp(a) - getProtocolSortTimestamp(b);

    let result = 0;
    if (protocolSortField === 'name') {
      result = nameResult || timeResult;
    } else {
      result = timeResult || nameResult;
    }

    if (!result) {
      result = String(a?.id || '').localeCompare(String(b?.id || ''));
    }

    return protocolSortOrder === 'asc' ? result : (result * -1);
  }

  function formatProtocolTimestamp(protocol) {
    const timestamp = getProtocolSortTimestamp(protocol);
    if (!timestamp) {
      return 'No timestamp';
    }
    return new Date(timestamp).toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  }

  function serializeProtocol(protocol) {
    const createdAt = normalizeIsoTimestamp(protocol?.createdAt);
    const updatedAt = normalizeIsoTimestamp(protocol?.updatedAt, createdAt);
    return {
      id: protocol.id,
      name: protocol.name,
      createdAt,
      updatedAt,
      purpose: String(protocol.purpose || '').trim(),
      materials: normalizeMaterials(protocol.materials),
      troubleshooting: String(protocol.troubleshooting || '').trim(),
      steps: (protocol.steps || []).map((step) => ({
        id: String(step?.id || createId()),
        text: getStepText(step),
        placeholders: (step?.placeholders || []).map((item) => ({ id: item.id, name: item.name }))
      }))
    };
  }

  function encodeBase64Url(value) {
    const source = String(value ?? '');
    const bytes = new TextEncoder().encode(source);
    let binary = '';
    bytes.forEach((byte) => {
      binary += String.fromCharCode(byte);
    });
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }

  function buildProtocolSharePayload(protocol) {
    const serializedProtocol = serializeProtocol(protocol);
    return {
      version: 1,
      type: 'protocol_share_link',
      createdAt: serializedProtocol.updatedAt || serializedProtocol.createdAt || '',
      from: resolveSenderEmail(),
      protocol: serializedProtocol
    };
  }

  function buildProtocolShareToken(protocol) {
    const payload = buildProtocolSharePayload(protocol);
    return encodeBase64Url(JSON.stringify(payload));
  }

  function buildProtocolShareLink(protocol) {
    return `${PROTOCOL_SHARE_LINK_PREFIX}${buildProtocolShareToken(protocol)}`;
  }

  async function copyProtocolShareLink(protocolId) {
    const protocol = state.protocols.find((item) => item.id === protocolId);
    if (!protocol) {
      return;
    }

    const shareLink = buildProtocolShareLink(protocol);
    const clipboard = globalThis.navigator?.clipboard;

    if (clipboard?.writeText) {
      try {
        await clipboard.writeText(shareLink);
        trackGrowthEvent?.(state, 'protocol_share_link_copied', {
          protocolId: protocol.id,
          protocolName: protocol.name,
          from: resolveSenderEmail()
        });
        persist();
        setShareStatus(`Copied a share link for "${protocol.name}". Paste it anywhere to invite an import.`);
        setShareLinkOutput(shareLink);
        activeShareProtocolId = '';
        activeShareTargetEmail = '';
        renderList();
        return;
      } catch {
        // Fall through to manual copy mode when clipboard access is unavailable.
      }
    }

    setShareStatus(`Share link ready for "${protocol.name}". Copy it from the field below.`);
    setShareLinkOutput(shareLink);
    activeShareProtocolId = '';
    activeShareTargetEmail = '';
    renderList();
  }

  function shareProtocol(protocolId, toEmail) {
    const protocol = state.protocols.find((item) => item.id === protocolId);
    if (!protocol) {
      return;
    }

    const to = String(toEmail || '').trim();
    if (!to) {
      setShareStatus('Select a teammate before sharing.');
      return;
    }

    const from = resolveSenderEmail();
    if (to.toLowerCase() === from.toLowerCase()) {
      setShareStatus('Cannot share a protocol to your own Enana email.');
      return;
    }

    const protocolPayload = buildProtocolSharePayload(protocol);
    const shareLink = `${PROTOCOL_SHARE_LINK_PREFIX}${encodeBase64Url(JSON.stringify(protocolPayload))}`;

    state.messages.push({
      id: createId(),
      from,
      to,
      subject: `[Protocol Share] ${protocol.name}`,
      body: `${from} shared protocol "${protocol.name}" with you.`,
      createdAt: new Date().toISOString(),
      readBy: [],
      importedBy: [],
      type: 'protocol_share',
      payload: {
        protocol: protocolPayload.protocol,
        shareLink
      }
    });

    trackGrowthEvent?.(state, 'protocol_share_sent', {
      protocolId: protocol.id,
      protocolName: protocol.name,
      from,
      to
    });

    persist();
    setShareStatus(`Shared "${protocol.name}" with ${to}.`);
    setShareLinkOutput('');
    activeShareProtocolId = '';
    activeShareTargetEmail = '';
    renderList();
  }

  function renderReadonlyStepSentence(step) {
    const source = getStepText(step);
    const placeholders = Array.isArray(step?.placeholders) ? step.placeholders : [];
    const matches = [...source.matchAll(PLACEHOLDER_TOKEN_REGEX)];

    if (!matches.length) {
      if (!placeholders.length) {
        return safeText(source);
      }
      const trailing = placeholders
        .map((placeholder) => String(placeholder?.name || '').trim())
        .filter(Boolean)
        .map((name) => `<span class="placeholder-chip placeholder-chip-static">${safeText(name)}</span>`)
        .join(' ');
      return `${safeText(source)} ${trailing}`.trim();
    }

    let cursor = 0;
    let html = '';

    matches.forEach((match) => {
      const index = Number(match.index || 0);
      const placeholderId = String(match[1] || '');
      const placeholder = placeholders.find((item) => String(item.id) === placeholderId);
      html += safeText(source.slice(cursor, index));
      html += `<span class="placeholder-chip placeholder-chip-static">${safeText(placeholder?.name || 'value')}</span>`;
      cursor = index + match[0].length;
    });

    html += safeText(source.slice(cursor));
    return html;
  }

  function populateEditorFormFromDraft(draft) {
    if (protocolNameInput) {
      protocolNameInput.value = String(draft?.name || '').trim();
    }
    if (protocolPurposeInput) {
      protocolPurposeInput.value = String(draft?.purpose || '').trim();
    }
    if (protocolMaterialsInput) {
      protocolMaterialsInput.value = formatBulletLines(draft?.materials);
    }
    if (protocolStepsInput) {
      protocolStepsInput.value = formatStepLines(draft?.steps);
    }
    if (protocolTroubleshootingInput) {
      protocolTroubleshootingInput.value = String(draft?.troubleshooting || '').trim();
    }
  }

  function buildProtocolPreviewMarkup(protocol, options = {}) {
    const includeNameSection = options.includeNameSection === true;
    const name = String(protocol?.name || '').trim();
    const purpose = String(protocol?.purpose || '').trim();
    const materials = normalizeMaterials(protocol?.materials);
    const troubleshooting = String(protocol?.troubleshooting || '').trim();
    const steps = Array.isArray(protocol?.steps) ? protocol.steps : [];

    const sections = [];
    if (includeNameSection) {
      sections.push(`
        <section class="protocol-view-section">
          <h4>Protocol Name</h4>
          ${name ? `<p>${safeText(name)}</p>` : '<p class="small-note">No protocol name provided.</p>'}
        </section>
      `);
    }

    sections.push(`
      <section class="protocol-view-section">
        <h4>Purpose</h4>
        ${purpose ? `<p>${safeText(purpose)}</p>` : '<p class="small-note">No purpose provided.</p>'}
      </section>
    `);

    sections.push(`
      <section class="protocol-view-section">
        <h4>Materials</h4>
        ${materials.length
          ? `<ul>${materials.map((item) => `<li>${safeText(item)}</li>`).join('')}</ul>`
          : '<p class="small-note">No materials provided.</p>'}
      </section>
    `);

    sections.push(`
      <section class="protocol-view-section">
        <h4>Steps</h4>
        ${steps.length
          ? `<ol class="protocol-view-steps">${steps.map((step) => `
              <li>
                ${renderReadonlyStepSentence(step)}
              </li>
            `).join('')}</ol>`
          : '<p class="small-note">No steps provided.</p>'}
      </section>
    `);

    sections.push(`
      <section class="protocol-view-section">
        <h4>Troubleshooting</h4>
        ${troubleshooting ? `<p>${safeText(troubleshooting)}</p>` : '<p class="small-note">No troubleshooting notes.</p>'}
      </section>
    `);

    return sections.join('');
  }

  function renderProtocolPreviewInto(node, protocol, options = {}) {
    if (!node) {
      return;
    }
    node.innerHTML = buildProtocolPreviewMarkup(protocol, options);
  }

  function renderProtocolPolishEmptyState(node, message, options = {}) {
    if (!node) {
      return;
    }
    const stateLabel = String(options.state || '').trim();
    const stateAttr = stateLabel ? ` data-state="${safeText(stateLabel)}"` : '';
    node.innerHTML = `
      <div class="protocol-polish-preview-empty"${stateAttr}>
        <p>${safeText(message || 'Nothing to preview yet.')}</p>
      </div>
    `;
  }

  function renderProtocolPolishLoadingState() {
    if (!protocolPolishResultPreview) {
      return;
    }
    protocolPolishResultPreview.innerHTML = `
      <div class="protocol-polish-loading">
        <div class="protocol-polish-loading-dots" aria-label="Loading polished protocol">
          <span>.</span>
          <span>.</span>
          <span>.</span>
        </div>
        <p>Polishing the current protocol draft while preserving its structure.</p>
      </div>
    `;
  }

  function setProtocolPolishPendingState(nextPending) {
    isProtocolPolishPending = nextPending === true;
    if (protocolPolishBtn) {
      protocolPolishBtn.disabled = isProtocolPolishPending;
      protocolPolishBtn.textContent = isProtocolPolishPending ? 'Polishing...' : 'Polish Protocol';
    }
    if (protocolPolishApplyBtn) {
      protocolPolishApplyBtn.disabled = isProtocolPolishPending || !polishedProtocolDraft;
    }
  }

  function setProtocolPolishStatus(message = '', options = {}) {
    if (!protocolPolishStatus) {
      return;
    }
    const normalized = String(message || '').trim();
    const stateLabel = String(options.state || '').trim();
    protocolPolishStatus.textContent = normalized;
    protocolPolishStatus.hidden = !normalized;
    if (stateLabel) {
      protocolPolishStatus.dataset.state = stateLabel;
    } else {
      delete protocolPolishStatus.dataset.state;
    }
  }

  function resetProtocolPolishState() {
    polishedProtocolDraft = null;
    protocolPolishSourceDraft = null;
    setProtocolPolishPendingState(false);
    setProtocolPolishStatus('');
    if (protocolPolishOriginalPreview) {
      protocolPolishOriginalPreview.innerHTML = '';
    }
    if (protocolPolishResultPreview) {
      protocolPolishResultPreview.innerHTML = '';
    }
  }

  function closeProtocolPolishOverlay() {
    protocolPolishRequestToken += 1;
    if (protocolPolishOverlay) {
      protocolPolishOverlay.hidden = true;
    }
    resetProtocolPolishState();
  }

  function hasDraftContent(draft) {
    return Boolean(
      String(draft?.name || '').trim()
      || String(draft?.purpose || '').trim()
      || String(draft?.troubleshooting || '').trim()
      || normalizeMaterials(draft?.materials).length
      || (Array.isArray(draft?.steps) ? draft.steps.length : 0)
    );
  }

  function buildProtocolPolishPrompt(draft) {
    return [
      'You are polishing a lab protocol draft for readability.',
      'Improve grammar, clarity, consistency, and wording while preserving the exact protocol structure.',
      'Keep the same five fields: name, purpose, materials, steps, troubleshooting.',
      'Keep the same scientific meaning, placeholder markers like [volume] and [temperature], and the step order unless a wording-only cleanup requires tiny local rephrasing.',
      'If the name is blank, create a concise protocol name from the existing content.',
      'Do not invent measurements, times, temperatures, reagents, troubleshooting details, or conclusions that are not already present.',
      'Return JSON only with this exact shape:',
      '{"name":"","purpose":"","materials":[""],"steps":[""],"troubleshooting":""}',
      '',
      'Protocol draft to polish:',
      JSON.stringify({
        name: draft?.name || '',
        purpose: draft?.purpose || '',
        materials: normalizeMaterials(draft?.materials),
        steps: Array.isArray(draft?.steps) ? draft.steps.map((step) => stepToEditableLine(step)) : [],
        troubleshooting: draft?.troubleshooting || ''
      }, null, 2)
    ].join('\n');
  }

  function resolvePolishedProtocolPayload(parsed) {
    if (Array.isArray(parsed)) {
      return parsed[0] || null;
    }
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }
    if (Array.isArray(parsed.protocols) && parsed.protocols.length) {
      return parsed.protocols[0];
    }
    if (parsed.protocol && typeof parsed.protocol === 'object') {
      return parsed.protocol;
    }
    if (parsed.polishedProtocol && typeof parsed.polishedProtocol === 'object') {
      return parsed.polishedProtocol;
    }
    if (parsed.polished_protocol && typeof parsed.polished_protocol === 'object') {
      return parsed.polished_protocol;
    }
    return parsed;
  }

  function normalizePolishedProtocolResponse(rawText, sourceDraft) {
    const parsed = parseJsonFromText(rawText);
    const candidate = resolvePolishedProtocolPayload(parsed);
    if (!candidate || typeof candidate !== 'object') {
      return null;
    }

    const mergedCandidate = {
      id: sourceDraft?.id || null,
      name: String(candidate.name || candidate.title || sourceDraft?.name || 'Protocol Draft').trim(),
      purpose: Object.prototype.hasOwnProperty.call(candidate, 'purpose')
        ? candidate.purpose
        : sourceDraft?.purpose,
      materials: Object.prototype.hasOwnProperty.call(candidate, 'materials')
        ? candidate.materials
        : sourceDraft?.materials,
      steps: Array.isArray(candidate.steps)
        ? candidate.steps
        : (Array.isArray(candidate.procedure) ? candidate.procedure : sourceDraft?.steps),
      troubleshooting: Object.prototype.hasOwnProperty.call(candidate, 'troubleshooting')
        ? candidate.troubleshooting
        : sourceDraft?.troubleshooting,
      createdAt: sourceDraft?.createdAt,
      updatedAt: sourceDraft?.updatedAt
    };

    const normalized = sanitizeIncomingProtocol(mergedCandidate);
    if (!normalized || !Array.isArray(normalized.steps) || !normalized.steps.length) {
      return null;
    }

    return {
      ...normalized,
      id: sourceDraft?.id || normalized.id,
      createdAt: sourceDraft?.createdAt || normalized.createdAt,
      updatedAt: sourceDraft?.updatedAt || normalized.updatedAt
    };
  }

  async function onPolishProtocol() {
    if (isProtocolPolishPending) {
      return;
    }

    const editorDraft = buildDraftFromEditorInputs();
    protocolPolishSourceDraft = cloneDraftFromProtocol(editorDraft);
    polishedProtocolDraft = null;
    setProtocolPolishPendingState(false);

    if (protocolPolishOverlay) {
      protocolPolishOverlay.hidden = false;
    }

    renderProtocolPreviewInto(protocolPolishOriginalPreview, protocolPolishSourceDraft, { includeNameSection: true });

    if (!hasDraftContent(protocolPolishSourceDraft)) {
      const message = 'Add some protocol content first, then try polishing again.';
      renderProtocolPolishEmptyState(protocolPolishResultPreview, message, { state: 'error' });
      setProtocolPolishStatus(message, { state: 'error' });
      return;
    }

    renderProtocolPolishLoadingState();
    setProtocolPolishStatus('Generating a polished version from the current editor draft.');
    setProtocolPolishPendingState(true);

    const requestToken = ++protocolPolishRequestToken;

    try {
      const rawResponse = await requestLlmText({
        llm: state.settings?.llm,
        prompt: buildProtocolPolishPrompt(protocolPolishSourceDraft)
      });

      if (requestToken !== protocolPolishRequestToken || protocolPolishOverlay?.hidden) {
        return;
      }

      const nextPolishedDraft = normalizePolishedProtocolResponse(rawResponse, protocolPolishSourceDraft);
      if (!nextPolishedDraft) {
        throw new Error('The model response could not be converted into a polished protocol.');
      }

      polishedProtocolDraft = nextPolishedDraft;
      renderProtocolPreviewInto(protocolPolishResultPreview, polishedProtocolDraft, { includeNameSection: true });
      setProtocolPolishStatus('Review the polished version on the right, then apply it if you want to replace the editor draft.');
    } catch (error) {
      if (requestToken !== protocolPolishRequestToken || protocolPolishOverlay?.hidden) {
        return;
      }
      const message = String(error?.message || error || 'Failed to polish this protocol.');
      renderProtocolPolishEmptyState(protocolPolishResultPreview, message, { state: 'error' });
      setProtocolPolishStatus(message, { state: 'error' });
    } finally {
      if (requestToken === protocolPolishRequestToken) {
        setProtocolPolishPendingState(false);
      }
    }
  }

  function applyPolishedProtocolToEditor() {
    if (!polishedProtocolDraft) {
      return;
    }

    currentProtocolDraft = cloneDraftFromProtocol({
      ...polishedProtocolDraft,
      id: currentProtocolDraft.id,
      createdAt: currentProtocolDraft.createdAt || polishedProtocolDraft.createdAt,
      updatedAt: currentProtocolDraft.updatedAt || polishedProtocolDraft.updatedAt
    });
    populateEditorFormFromDraft(currentProtocolDraft);
    closeProtocolPolishOverlay();
    protocolNameInput?.focus();
  }

  function resetEditorDraft() {
    closeProtocolPolishOverlay();
    currentProtocolDraft = createEmptyDraft();
    protocolForm?.reset();
    resetProtocolJsonImportUi();
  }

  function setSelectedProtocol(protocolId = '') {
    activeProtocolId = String(protocolId || '').trim();
  }

  function getSelectedProtocol() {
    if (!activeProtocolId) {
      return null;
    }
    return state.protocols.find((item) => String(item?.id || '') === activeProtocolId) || null;
  }

  function applyDetailMode(nextMode) {
    protocolDetailMode = nextMode;
    if (protocolDetailPanel) {
      protocolDetailPanel.dataset.mode = nextMode;
    }
    if (protocolEmptyPanel) {
      protocolEmptyPanel.hidden = nextMode !== 'empty';
    }
    if (protocolEditorPanel) {
      protocolEditorPanel.hidden = nextMode !== 'edit';
    }
    if (protocolViewPanel) {
      protocolViewPanel.hidden = nextMode !== 'view';
    }
  }

  function showEmptyPanel({ resetEditor = false } = {}) {
    if (resetEditor) {
      resetEditorDraft();
    }
    applyDetailMode('empty');
  }

  function showEditorPanel() {
    applyDetailMode('edit');
    syncProtocolImportPanelVisibility();
  }

  function showViewPanel() {
    applyDetailMode('view');
  }

  function syncSelectionAfterMutation() {
    if (protocolDetailMode === 'edit' && !currentProtocolDraft.id) {
      return;
    }

    const selectedProtocol = getSelectedProtocol();
    if (selectedProtocol) {
      if (protocolDetailMode === 'view') {
        renderProtocolView(selectedProtocol);
      }
      return;
    }

    if (!state.protocols.length) {
      setSelectedProtocol('');
      showEmptyPanel({ resetEditor: protocolDetailMode === 'edit' });
      return;
    }

    const firstProtocol = [...state.protocols].sort(compareProtocols)[0];
    if (firstProtocol) {
      setSelectedProtocol(firstProtocol.id);
      renderProtocolView(firstProtocol);
      showViewPanel();
    }
  }

  function onCancelEditor() {
    const selectedProtocol = getSelectedProtocol();
    if (selectedProtocol) {
      renderProtocolView(selectedProtocol);
      showViewPanel();
      return;
    }
    showEmptyPanel({ resetEditor: true });
  }

  function openEditorWithDraft(protocol, headingText, options = {}) {
    isCreateEditorMode = options.isCreateMode !== false;
    currentProtocolDraft = cloneDraftFromProtocol(protocol);

    if (isCreateEditorMode) {
      resetProtocolJsonImportUi();
    }

    if (protocolEditorHeading) {
      protocolEditorHeading.textContent = headingText;
    }

    populateEditorFormFromDraft(currentProtocolDraft);

    showEditorPanel();
    protocolNameInput?.focus();
  }

  function onCreateProtocol() {
    setSelectedProtocol('');
    openEditorWithDraft(createEmptyDraft(), 'Create Protocol', { isCreateMode: true });
  }

  function editProtocol(protocolId) {
    const protocol = state.protocols.find((item) => item.id === protocolId);
    if (!protocol) {
      return;
    }

    setSelectedProtocol(protocol.id);
    openEditorWithDraft(protocol, 'Edit Protocol', { isCreateMode: false });
  }

  function renderProtocolView(protocol) {
    if (!protocolViewTitle || !protocolViewContent) {
      return;
    }

    protocolViewTitle.textContent = protocol.name || 'Protocol';
    protocolViewContent.innerHTML = buildProtocolPreviewMarkup(protocol);
  }

  function viewProtocol(protocolId) {
    const protocol = state.protocols.find((item) => item.id === protocolId);
    if (!protocol) {
      return;
    }

    setSelectedProtocol(protocol.id);
    renderProtocolView(protocol);
    showViewPanel();
  }

  function onExportViewedProtocolPdf() {
    const protocol = getSelectedProtocol();
    if (!protocol) {
      return;
    }
    exportProtocolPdf(protocol);
  }

  function deleteProtocol(protocolId) {
    const now = new Date().toISOString();
    const deletedEntryIds = new Set(
      state.notebookEntries
        .filter((entry) => entry.protocolId === protocolId)
        .map((entry) => entry.id)
    );

    state.protocols = state.protocols.filter((item) => item.id !== protocolId);
    state.notebookEntries = state.notebookEntries.filter((entry) => entry.protocolId !== protocolId);
    state.workflows = (state.workflows || []).map((workflow) => {
      const blocks = (workflow.blocks || []).filter((block) => block.protocolId !== protocolId);
      if (blocks.length === (workflow.blocks || []).length) {
        return workflow;
      }
      const validBlockIds = new Set(blocks.map((block) => block.id));
      const links = (workflow.links || []).filter((link) => (
        validBlockIds.has(link.fromBlockId)
        && validBlockIds.has(link.toBlockId)
        && link.fromBlockId !== link.toBlockId
      ));
      return {
        ...workflow,
        blocks,
        links,
        updatedAt: now
      };
    });
    state.workflowTemplates = (state.workflowTemplates || []).map((template) => {
      const blocks = (template.blocks || []).filter((block) => block.protocolId !== protocolId);
      if (blocks.length === (template.blocks || []).length) {
        return template;
      }
      const validBlockIds = new Set(blocks.map((block) => block.id));
      const links = (template.links || []).filter((link) => (
        validBlockIds.has(link.fromBlockId)
        && validBlockIds.has(link.toBlockId)
        && link.fromBlockId !== link.toBlockId
      ));
      return {
        ...template,
        blocks,
        links,
        updatedAt: now
      };
    });

    if (deletedEntryIds.size) {
      state.assays = (state.assays || []).map((assay) => {
        if (!deletedEntryIds.has(assay.notebookEntryId)) {
          return assay;
        }
        return {
          ...assay,
          notebookEntryId: '',
          notebookEntryProtocolName: '',
          notebookEntryType: '',
          updatedAt: new Date().toISOString()
        };
      });

      state.gelAnalyses = (state.gelAnalyses || []).map((analysis) => {
        if (!deletedEntryIds.has(analysis.notebookEntryId)) {
          return analysis;
        }
        return {
          ...analysis,
          notebookEntryId: '',
          notebookEntryProtocolName: '',
          notebookEntryType: '',
          updatedAt: new Date().toISOString()
        };
      });
    }

    persist();
    renderList();
    setShareLinkOutput('');
    if (activeProtocolId === protocolId) {
      setSelectedProtocol('');
    }
    syncSelectionAfterMutation();
    onProtocolsChanged();
  }

  function addInteractivePlaceholderToken(placeholderName = '') {
    const placeholder = String(placeholderName || placeholderNameInput?.value || '').trim();
    if (!placeholder || !protocolStepsInput) {
      return;
    }

    insertTokenAtCursor(protocolStepsInput, `[${placeholder}]`);
    if (placeholderNameInput) {
      placeholderNameInput.value = '';
    }
  }

  function onProtocolSubmit(event) {
    event.preventDefault();

    const editorDraft = buildDraftFromEditorInputs();
    const protocolName = editorDraft.name;
    const purpose = editorDraft.purpose;
    const materials = editorDraft.materials;
    const troubleshooting = editorDraft.troubleshooting;
    const steps = editorDraft.steps;

    if (!protocolName || !steps.length) {
      return;
    }

    const nowIso = new Date().toISOString();
    const createdAt = normalizeIsoTimestamp(currentProtocolDraft.createdAt, nowIso);

    const protocol = {
      id: currentProtocolDraft.id || createId(),
      name: protocolName,
      purpose,
      materials,
      steps,
      troubleshooting,
      createdAt,
      updatedAt: nowIso
    };

    const index = state.protocols.findIndex((item) => item.id === protocol.id);
    if (index >= 0) {
      state.protocols[index] = protocol;
    } else {
      state.protocols.push(protocol);
    }

    persist();
    setSelectedProtocol(protocol.id);
    renderProtocolView(protocol);
    renderList();
    onProtocolsChanged();
    resetEditorDraft();
    showViewPanel();
  }

  function renderList() {
    if (!protocolList) {
      return;
    }

    ensureProtocolTimestamps();
    updateSortButtonLabels();

    if (!state.protocols.length) {
      protocolList.innerHTML = '<p class="small-note">No saved protocols yet.</p>';
      syncSelectionAfterMutation();
      return;
    }

    const shareOptions = ['<option value="">Select teammate</option>'];
    getShareTargetEmails().forEach((email) => {
      const selectedAttr = activeShareTargetEmail === email ? ' selected' : '';
      shareOptions.push(`<option value="${safeText(email)}"${selectedAttr}>${safeText(email)}</option>`);
    });

    const sortedProtocols = [...state.protocols].sort(compareProtocols);

    protocolList.innerHTML = sortedProtocols.map((protocol) => `
      <article
        class="list-row protocol-list-row${activeShareProtocolId === protocol.id ? ' protocol-list-row-share-open' : ''}${activeProtocolId === protocol.id ? ' protocol-list-row-selected list-row-selected' : ''}"
        data-protocol-select="${protocol.id}"
        tabindex="0"
      >
        <div class="protocol-name-text-wrap">
          <span class="protocol-name-text">${safeText(protocol.name)}</span>
          <span class="protocol-row-meta">Updated ${safeText(formatProtocolTimestamp(protocol))}</span>
        </div>
        <div class="card-actions list-actions protocol-list-actions">
          <div class="protocol-legacy-actions" hidden>
            <button type="button" class="ghost-btn protocol-view-btn" data-protocol-view="${protocol.id}">View</button>
            <button type="button" class="ghost-btn protocol-view-btn" data-protocol-export="${protocol.id}">Export PDF</button>
            <button type="button" class="ghost-btn protocol-edit-btn" data-protocol-edit="${protocol.id}">Edit</button>
            <button type="button" class="ghost-btn protocol-share-btn" data-protocol-share="${protocol.id}">Share</button>
            <button type="button" class="danger-btn protocol-delete-btn" data-protocol-delete="${protocol.id}">Delete</button>
          </div>
          <button
            type="button"
            class="ghost-btn protocol-menu-btn${activeMenuProtocolId === protocol.id ? ' is-open' : ''}"
            data-protocol-menu-trigger="${protocol.id}"
            aria-haspopup="menu"
            aria-expanded="${activeMenuProtocolId === protocol.id ? 'true' : 'false'}"
            aria-label="Protocol actions"
            title="Protocol actions"
          >...</button>
          ${activeMenuProtocolId === protocol.id ? `
            <div class="protocol-action-menu protocol-preview-block" role="menu">
              <button type="button" class="ghost-btn protocol-action-item" data-protocol-action="edit" data-protocol-id="${protocol.id}">Edit</button>
              <button type="button" class="ghost-btn protocol-action-item" data-protocol-action="export" data-protocol-id="${protocol.id}">Export PDF</button>
              <button type="button" class="ghost-btn protocol-action-item" data-protocol-action="share" data-protocol-id="${protocol.id}">Share</button>
              <button type="button" class="ghost-btn protocol-action-item protocol-action-item-danger" data-protocol-action="delete" data-protocol-id="${protocol.id}">Delete</button>
            </div>
          ` : ''}
        </div>
        ${activeShareProtocolId === protocol.id ? `
          <div class="protocol-share-inline">
            <select data-protocol-share-select="${protocol.id}">
              ${shareOptions.join('')}
            </select>
            <button type="button" class="primary-btn" data-protocol-share-confirm="${protocol.id}" ${activeShareTargetEmail ? '' : 'disabled'}>Confirm</button>
            <button type="button" class="ghost-btn" data-protocol-copy-link="${protocol.id}">Copy Link</button>
            <button type="button" class="ghost-btn" data-protocol-share-cancel>Cancel</button>
          </div>
        ` : ''}
      </article>
    `).join('');

    protocolList.querySelectorAll('[data-protocol-view]').forEach((button) => {
      button.addEventListener('click', () => viewProtocol(button.dataset.protocolView));
    });

    protocolList.querySelectorAll('[data-protocol-select]').forEach((row) => {
      row.addEventListener('click', (event) => {
        const target = event.target;
        const interactive = typeof target?.closest === 'function'
          ? target.closest('button, select, textarea, input, .protocol-share-inline, .protocol-action-menu')
          : null;
        if (interactive) {
          return;
        }
        viewProtocol(row.dataset.protocolSelect);
      });
      row.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') {
          return;
        }
        const target = event.target;
        const interactive = typeof target?.closest === 'function'
          ? target.closest('button, select, textarea, input, .protocol-share-inline, .protocol-action-menu')
          : null;
        if (interactive) {
          return;
        }
        event.preventDefault?.();
        viewProtocol(row.dataset.protocolSelect);
      });
    });

    protocolList.querySelectorAll('[data-protocol-edit]').forEach((button) => {
      button.addEventListener('click', () => editProtocol(button.dataset.protocolEdit));
    });

    protocolList.querySelectorAll('[data-protocol-export]').forEach((button) => {
      button.addEventListener('click', () => {
        const protocol = state.protocols.find((item) => item.id === button.dataset.protocolExport);
        if (!protocol) {
          return;
        }
        exportProtocolPdf(protocol);
      });
    });

    protocolList.querySelectorAll('[data-protocol-share]').forEach((button) => {
      button.addEventListener('click', () => {
        const protocolId = String(button.dataset.protocolShare || '');
        activeMenuProtocolId = '';
        if (activeShareProtocolId === protocolId) {
          activeShareProtocolId = '';
          activeShareTargetEmail = '';
        } else {
          activeShareProtocolId = protocolId;
          activeShareTargetEmail = '';
        }
        renderList();
      });
    });

    protocolList.querySelectorAll('[data-protocol-delete]').forEach((button) => {
      button.addEventListener('click', () => deleteProtocol(button.dataset.protocolDelete));
    });

    protocolList.querySelectorAll('[data-protocol-share-select]').forEach((select) => {
      select.addEventListener('change', () => {
        activeShareTargetEmail = String(select.value || '').trim();
        renderList();
      });
    });

    protocolList.querySelectorAll('[data-protocol-share-confirm]').forEach((button) => {
      button.addEventListener('click', () => {
        const protocolId = String(button.dataset.protocolShareConfirm || '');
        shareProtocol(protocolId, activeShareTargetEmail);
      });
    });

    protocolList.querySelectorAll('[data-protocol-copy-link]').forEach((button) => {
      button.addEventListener('click', () => {
        void copyProtocolShareLink(String(button.dataset.protocolCopyLink || ''));
      });
    });

    protocolList.querySelectorAll('[data-protocol-share-cancel]').forEach((button) => {
      button.addEventListener('click', () => {
        activeShareProtocolId = '';
        activeShareTargetEmail = '';
        renderList();
      });
    });

    protocolList.querySelectorAll('[data-protocol-menu-trigger]').forEach((button) => {
      button.addEventListener('click', (event) => {
        event.stopPropagation?.();
        const protocolId = String(button.dataset.protocolMenuTrigger || '');
        activeMenuProtocolId = activeMenuProtocolId === protocolId ? '' : protocolId;
        renderList();
      });
    });

    protocolList.querySelectorAll('[data-protocol-action]').forEach((button) => {
      button.addEventListener('click', () => {
        const action = String(button.dataset.protocolAction || '');
        const protocolId = String(button.dataset.protocolId || '');
        activeMenuProtocolId = '';
        if (action === 'edit') {
          renderList();
          editProtocol(protocolId);
          return;
        }
        if (action === 'export') {
          const protocol = state.protocols.find((item) => item.id === protocolId);
          if (protocol) {
            exportProtocolPdf(protocol);
          }
          renderList();
          return;
        }
        if (action === 'share') {
          activeShareProtocolId = activeShareProtocolId === protocolId ? '' : protocolId;
          activeShareTargetEmail = '';
          renderList();
          return;
        }
        if (action === 'delete') {
          deleteProtocol(protocolId);
        }
      });
    });

    syncSelectionAfterMutation();
  }

  function addDraftFromExtractedMethod(method, source) {
    const protocolShapeCandidate = Array.isArray(method) ? method.find((item) => item && typeof item === 'object') : method;
    const methodTitle = String(
      protocolShapeCandidate?.title
      || protocolShapeCandidate?.name
      || 'Extracted Method'
    ).trim();
    const sourceTitle = String(source?.title || 'Paper').trim();
    const steps = Array.isArray(protocolShapeCandidate?.steps) ? protocolShapeCandidate.steps : [];
    const citations = Array.isArray(protocolShapeCandidate?.citations) ? protocolShapeCandidate.citations.filter(Boolean) : [];
    const purpose = String(protocolShapeCandidate?.purpose || '').trim();
    const materials = normalizeMaterials(protocolShapeCandidate?.materials);
    const troubleshooting = normalizeTroubleshooting(protocolShapeCandidate?.troubleshooting);

    const convertedSteps = normalizeMethodStepEntries(steps);

    if (citations.length) {
      convertedSteps.unshift({
        id: createId(),
        text: `Source citation(s): ${citations.join('; ')}`,
        placeholders: []
      });
    }

    if (!convertedSteps.length) {
      return false;
    }

    openEditorWithDraft({
      id: null,
      name: `${sourceTitle} - ${methodTitle}`.trim(),
      purpose,
      materials,
      steps: convertedSteps,
      troubleshooting
    }, 'Create Protocol', { isCreateMode: true });

    return true;
  }

  return {
    renderShareTargets,
    renderList,
    editProtocol,
    addDraftFromExtractedMethod,
    importProtocolsFromJson
  };
}
