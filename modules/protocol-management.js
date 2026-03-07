import { exportProtocolPdf } from './pdf-export.js';

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
  const protocolEditorPanel = document.getElementById('protocol-editor-panel');
  const protocolViewPanel = document.getElementById('protocol-view-panel');

  const createProtocolBtn = document.getElementById('create-protocol-btn');
  const protocolEditorBackBtn = document.getElementById('protocol-editor-back-btn');
  const protocolCancelBtn = document.getElementById('protocol-cancel-btn');
  const protocolViewBackBtn = document.getElementById('protocol-view-back-btn');
  const protocolExportPdfBtn = document.getElementById('protocol-export-pdf-btn');

  const protocolEditorHeading = document.getElementById('protocol-editor-heading');
  const protocolViewTitle = document.getElementById('protocol-view-title');
  const protocolViewContent = document.getElementById('protocol-view-content');

  const protocolForm = document.getElementById('protocol-form');
  const protocolNameInput = document.getElementById('protocol-name');
  const protocolPurposeInput = document.getElementById('protocol-purpose');
  const protocolMaterialsInput = document.getElementById('protocol-materials');
  const protocolStepsInput = document.getElementById('protocol-steps');
  const protocolTroubleshootingInput = document.getElementById('protocol-troubleshooting');

  const addPlaceholderBtn = document.getElementById('add-placeholder-btn');
  const placeholderNameInput = document.getElementById('placeholder-name');

  const protocolShareStatus = document.getElementById('protocol-share-status');
  const protocolShareLinkPanel = document.getElementById('protocol-share-link-panel');
  const protocolShareLinkOutput = document.getElementById('protocol-share-link-output');
  const protocolList = document.getElementById('protocol-list');
  const protocolSortFieldBtn = document.getElementById('protocol-sort-field-btn');
  const protocolSortOrderBtn = document.getElementById('protocol-sort-order-btn');

  const defaultShareStatus = 'Click Share on a protocol to send it to a teammate or copy a portable share link.';

  let currentProtocolDraft = createEmptyDraft();
  let activeShareProtocolId = '';
  let activeShareTargetEmail = '';
  let protocolSortField = 'time';
  let protocolSortOrder = 'asc';
  let activeViewedProtocolId = '';

  createProtocolBtn?.addEventListener('click', onCreateProtocol);
  protocolEditorBackBtn?.addEventListener('click', () => showListPanel({ resetEditor: true }));
  protocolCancelBtn?.addEventListener('click', () => showListPanel({ resetEditor: true }));
  protocolViewBackBtn?.addEventListener('click', () => showListPanel({ resetEditor: false }));

  protocolForm?.addEventListener('submit', onProtocolSubmit);
  protocolMaterialsInput?.addEventListener('focus', () => ensureLeadingBullet(protocolMaterialsInput));
  protocolMaterialsInput?.addEventListener('keydown', onBulletTextareaKeydown);
  protocolMaterialsInput?.addEventListener('blur', () => normalizeBulletTextarea(protocolMaterialsInput));
  protocolStepsInput?.addEventListener('focus', () => ensureLeadingBullet(protocolStepsInput));
  protocolStepsInput?.addEventListener('keydown', onBulletTextareaKeydown);
  protocolStepsInput?.addEventListener('blur', () => normalizeBulletTextarea(protocolStepsInput));
  addPlaceholderBtn?.addEventListener('click', addInteractivePlaceholderToken);
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

  if (protocolShareStatus && !String(protocolShareStatus.textContent || '').trim()) {
    setShareStatus(defaultShareStatus);
  }
  updateSortButtonLabels();

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
      .replace(/\[([^[\]]+)\]/g, (_, name) => {
        const trimmed = String(name).trim();
        if (trimmed) {
          const id = createId();
          placeholders.push({ id, name: trimmed });
          return `{{ph:${id}}}`;
        }
        return '';
      })
      .replace(/\s+/g, ' ')
      .trim();

    return { cleanedText: cleaned, placeholders };
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
    protocolShareStatus.textContent = message;
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

  function resetEditorDraft() {
    currentProtocolDraft = createEmptyDraft();
    protocolForm?.reset();
  }

  function showListPanel({ resetEditor = false } = {}) {
    if (resetEditor) {
      resetEditorDraft();
    }

    if (protocolListPanel) {
      protocolListPanel.hidden = false;
    }
    if (protocolEditorPanel) {
      protocolEditorPanel.hidden = true;
    }
    if (protocolViewPanel) {
      protocolViewPanel.hidden = true;
    }
    activeViewedProtocolId = '';
  }

  function showEditorPanel() {
    if (protocolListPanel) {
      protocolListPanel.hidden = true;
    }
    if (protocolEditorPanel) {
      protocolEditorPanel.hidden = false;
    }
    if (protocolViewPanel) {
      protocolViewPanel.hidden = true;
    }
  }

  function showViewPanel() {
    if (protocolListPanel) {
      protocolListPanel.hidden = true;
    }
    if (protocolEditorPanel) {
      protocolEditorPanel.hidden = true;
    }
    if (protocolViewPanel) {
      protocolViewPanel.hidden = false;
    }
  }

  function openEditorWithDraft(protocol, headingText) {
    currentProtocolDraft = cloneDraftFromProtocol(protocol);

    if (protocolEditorHeading) {
      protocolEditorHeading.textContent = headingText;
    }

    if (protocolNameInput) {
      protocolNameInput.value = currentProtocolDraft.name;
    }
    if (protocolPurposeInput) {
      protocolPurposeInput.value = currentProtocolDraft.purpose;
    }
    if (protocolMaterialsInput) {
      protocolMaterialsInput.value = formatBulletLines(currentProtocolDraft.materials);
    }
    if (protocolStepsInput) {
      protocolStepsInput.value = formatStepLines(currentProtocolDraft.steps);
    }
    if (protocolTroubleshootingInput) {
      protocolTroubleshootingInput.value = currentProtocolDraft.troubleshooting;
    }

    showEditorPanel();
    protocolNameInput?.focus();
  }

  function onCreateProtocol() {
    openEditorWithDraft(createEmptyDraft(), 'Create Protocol');
  }

  function editProtocol(protocolId) {
    const protocol = state.protocols.find((item) => item.id === protocolId);
    if (!protocol) {
      return;
    }

    openEditorWithDraft(protocol, 'Edit Protocol');
  }

  function renderProtocolView(protocol) {
    if (!protocolViewTitle || !protocolViewContent) {
      return;
    }

    const purpose = String(protocol?.purpose || '').trim();
    const materials = normalizeMaterials(protocol?.materials);
    const troubleshooting = String(protocol?.troubleshooting || '').trim();
    const steps = Array.isArray(protocol?.steps) ? protocol.steps : [];

    const materialsHtml = materials.length
      ? `<ul>${materials.map((item) => `<li>${safeText(item)}</li>`).join('')}</ul>`
      : '<p class="small-note">No materials provided.</p>';

    const stepsHtml = steps.length
      ? `<ol class="protocol-view-steps">${steps.map((step) => `
          <li>
            ${renderReadonlyStepSentence(step)}
          </li>
        `).join('')}</ol>`
      : '<p class="small-note">No steps provided.</p>';

    protocolViewTitle.textContent = protocol.name || 'Protocol';
    protocolViewContent.innerHTML = `
      <section class="protocol-view-section">
        <h4>Purpose</h4>
        ${purpose ? `<p>${safeText(purpose)}</p>` : '<p class="small-note">No purpose provided.</p>'}
      </section>
      <section class="protocol-view-section">
        <h4>Materials</h4>
        ${materialsHtml}
      </section>
      <section class="protocol-view-section">
        <h4>Steps</h4>
        ${stepsHtml}
      </section>
      <section class="protocol-view-section">
        <h4>Troubleshooting</h4>
        ${troubleshooting ? `<p>${safeText(troubleshooting)}</p>` : '<p class="small-note">No troubleshooting notes.</p>'}
      </section>
    `;
  }

  function viewProtocol(protocolId) {
    const protocol = state.protocols.find((item) => item.id === protocolId);
    if (!protocol) {
      return;
    }

    activeViewedProtocolId = protocol.id;
    renderProtocolView(protocol);
    showViewPanel();
  }

  function onExportViewedProtocolPdf() {
    if (!activeViewedProtocolId) {
      return;
    }
    const protocol = state.protocols.find((item) => item.id === activeViewedProtocolId);
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
    showListPanel({ resetEditor: true });
    onProtocolsChanged();
  }

  function addInteractivePlaceholderToken() {
    const placeholder = String(placeholderNameInput?.value || '').trim();
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

    const protocolName = String(protocolNameInput?.value || '').trim();
    const purpose = String(protocolPurposeInput?.value || '').trim();
    const materials = parseBulletLines(protocolMaterialsInput?.value || '');
    const troubleshooting = String(protocolTroubleshootingInput?.value || '').trim();
    const steps = buildStepEntriesFromText(protocolStepsInput?.value || '', currentProtocolDraft.steps)
      .map((entry) => cloneStep(entry.step));

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
    renderList();
    onProtocolsChanged();
    showListPanel({ resetEditor: true });
  }

  function renderList() {
    if (!protocolList) {
      return;
    }

    ensureProtocolTimestamps();
    updateSortButtonLabels();

    if (!state.protocols.length) {
      protocolList.innerHTML = '<p class="small-note">No saved protocols yet.</p>';
      return;
    }

    const shareOptions = ['<option value="">Select teammate</option>'];
    getShareTargetEmails().forEach((email) => {
      const selectedAttr = activeShareTargetEmail === email ? ' selected' : '';
      shareOptions.push(`<option value="${safeText(email)}"${selectedAttr}>${safeText(email)}</option>`);
    });

    const sortedProtocols = [...state.protocols].sort(compareProtocols);

    protocolList.innerHTML = sortedProtocols.map((protocol) => `
      <article class="list-row protocol-list-row${activeShareProtocolId === protocol.id ? ' protocol-list-row-share-open' : ''}">
        <span class="protocol-name-text">${safeText(protocol.name)}</span>
        <div class="card-actions list-actions protocol-list-actions">
          <button type="button" class="ghost-btn protocol-view-btn" data-protocol-view="${protocol.id}">View</button>
          <button type="button" class="ghost-btn protocol-view-btn" data-protocol-export="${protocol.id}">Export PDF</button>
          <button type="button" class="ghost-btn protocol-edit-btn" data-protocol-edit="${protocol.id}">Edit</button>
          <button type="button" class="ghost-btn protocol-share-btn" data-protocol-share="${protocol.id}">Share</button>
          <button type="button" class="danger-btn protocol-delete-btn" data-protocol-delete="${protocol.id}">Delete</button>
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
  }

  function addDraftFromExtractedMethod(method, source) {
    const methodTitle = String(method?.title || 'Extracted Method').trim();
    const sourceTitle = String(source?.title || 'Paper').trim();
    const steps = Array.isArray(method?.steps) ? method.steps : [];
    const citations = Array.isArray(method?.citations) ? method.citations.filter(Boolean) : [];

    const convertedSteps = steps
      .map((rawStep) => String(rawStep || '').trim())
      .filter(Boolean)
      .map((text) => {
        const parsed = extractPlaceholdersFromText(text);
        return {
          id: createId(),
          text: parsed.cleanedText || text,
          placeholders: parsed.placeholders
        };
      });

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
      purpose: '',
      materials: [],
      steps: convertedSteps,
      troubleshooting: ''
    }, 'Create Protocol');

    return true;
  }

  return {
    renderShareTargets,
    renderList,
    editProtocol,
    addDraftFromExtractedMethod
  };
}
