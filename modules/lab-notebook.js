export function initLabNotebook({
  state,
  persist,
  createId,
  safeText,
  onNotebookEntriesChanged,
  notebookType = 'synthesis'
}) {
  const PLACEHOLDER_TOKEN_REGEX = /\{\{ph:([^}]+)\}\}/g;
  const SYNTHESIS_ENTRY_PROTOCOL_KEY = '__synthesis__';
  const SYNTHESIS_ENTRY_PROTOCOL_NAME = 'Synthesis Notebook';
  const notebookProjectSelect = document.getElementById('synthesis-notebook-project-select');
  const notebookProtocolArea = document.getElementById('synthesis-notebook-protocol-area');
  const notebookProtocolTitle = document.getElementById('synthesis-notebook-protocol-title');
  const notebookSteps = document.getElementById('synthesis-notebook-steps');
  const notebookResult = document.getElementById('synthesis-notebook-result');
  const notebookResultFile = document.getElementById('synthesis-notebook-result-file');
  const refInstrument = document.getElementById('synthesis-ref-instrument');
  const refPeopleIds = document.getElementById('synthesis-ref-people-ids');
  const refChemicalIds = document.getElementById('synthesis-ref-chemical-ids');
  const refSampleIds = document.getElementById('synthesis-ref-sample-ids');
  const refPaperIds = document.getElementById('synthesis-ref-paper-ids');
  const refReagentLots = document.getElementById('synthesis-ref-reagent-lots');
  const synthesisProducedCompound = document.getElementById('synthesis-produced-compound');
  const synthesisPurity = document.getElementById('synthesis-purity');
  const synthesisUsedInAssay = document.getElementById('synthesis-used-in-assay');
  const saveNotebookBtn = document.getElementById('save-synthesis-notebook-btn');
  const cancelEditBtn = document.getElementById('cancel-synthesis-notebook-edit-btn');
  const notebookEntryList = document.getElementById('synthesis-notebook-entry-list');

  const notebookKetcherFrame = document.getElementById('synthesis-notebook-ketcher-frame');
  const chemistryEnabledToggle = document.getElementById('synthesis-chem-enabled');
  const chemistryWorkflow = document.getElementById('synthesis-chem-workflow');
  const chemistryInput = document.getElementById('synthesis-chem-input');
  const chemistryNextBtn = document.getElementById('synthesis-chem-next-btn');
  const chemistryProductBtn = document.getElementById('synthesis-chem-product-btn');
  const chemistryEndBtn = document.getElementById('synthesis-chem-end-btn');
  const chemistryResetBtn = document.getElementById('synthesis-chem-reset-btn');
  const chemistryStatus = document.getElementById('synthesis-chem-status');
  const chemistryScheme = document.getElementById('synthesis-reaction-scheme');
  const chemistryNumbers = document.getElementById('synthesis-substrate-numbering');
  const chemistryMwTableBody = document.getElementById('synthesis-mw-table-body');
  const chemistryProcedureInput = document.getElementById('synthesis-procedure-input');

  let currentLookup = { query: '', result: null };
  let lookupTicket = 0;
  let synthesisChemistryState = createEmptyChemistryState();
  let editingEntryId = null;

  notebookProjectSelect.addEventListener('change', onProjectChange);
  saveNotebookBtn?.addEventListener('click', saveEntry);
  cancelEditBtn?.addEventListener('click', cancelEdit);
  notebookEntryList?.addEventListener('click', onEntryListClick);

  notebookSteps.addEventListener('click', onInlinePlaceholderClick);
  notebookSteps.addEventListener('blur', onInlinePlaceholderBlur, true);
  notebookSteps.addEventListener('keydown', onInlinePlaceholderKeydown);

  chemistryEnabledToggle?.addEventListener('change', onChemistryToggleChange);
  chemistryNextBtn?.addEventListener('click', onChemistryNext);
  chemistryProductBtn?.addEventListener('click', onChemistryProductMode);
  chemistryEndBtn?.addEventListener('click', onChemistryEnd);
  chemistryResetBtn?.addEventListener('click', onChemistryReset);
  chemistryMwTableBody?.addEventListener('input', onChemistryMwInputChange);
  chemistryProcedureInput?.addEventListener('input', persistChemistryDraft);
  updateSaveButtonLabel();

  function onProjectChange() {
    editingEntryId = null;
    updateSaveButtonLabel();
    renderReferenceOptions();
    renderProtocolOptions();
  }

  function buildNotebookFolderPath(projectName) {
    const rootPath = state.settings.storagePath.trim();
    if (!rootPath) {
      return '';
    }
    const safeProject = sanitizeFolderName(projectName);
    const experimentDateTime = new Date().toISOString().replace('T', '_').replace(/[:.]/g, '-').replace('Z', '');
    return `${rootPath}/Project/${safeProject || 'Untitled_Project'}/Notebook/${experimentDateTime}`;
  }

  function sanitizeFolderName(value) {
    return String(value || '')
      .trim()
      .replace(/[<>:"/\\|?*\x00-\x1F]+/g, '_')
      .replace(/\s+/g, '_')
      .replace(/^_+|_+$/g, '');
  }

  function onProtocolChange() {
    const projectId = notebookProjectSelect.value;
    const project = state.projects.find((item) => item.id === projectId);

    if (!project) {
      notebookProtocolArea.hidden = true;
      notebookSteps.innerHTML = '';
      notebookResult.value = '';
      notebookResultFile.value = '';
      refInstrument.value = '';
      refPeopleIds.value = '';
      refChemicalIds.value = '';
      setMultiSelectValues(refSampleIds, []);
      refPaperIds.value = '';
      refReagentLots.value = '';
      synthesisProducedCompound.value = '';
      synthesisPurity.value = '';
      synthesisUsedInAssay.value = '';
      synthesisChemistryState = createEmptyChemistryState();
      renderSynthesisChemistry();
      return;
    }

    notebookProtocolArea.hidden = false;
    notebookProtocolTitle.textContent = SYNTHESIS_ENTRY_PROTOCOL_NAME;

    const editingEntry = editingEntryId
      ? state.notebookEntries.find((entry) => entry.id === editingEntryId && matchesNotebookType(entry))
      : null;
    const existingEntry = editingEntry && editingEntry.projectId === project.id
      ? editingEntry
      : state.notebookEntries.find(
        (entry) => entry.projectId === project.id && matchesNotebookType(entry)
      );
    if (!editingEntry || existingEntry?.id !== editingEntry.id) {
      editingEntryId = null;
    }
    const values = existingEntry?.values || {};

    notebookSteps.innerHTML = '';

    notebookResult.value = existingEntry?.result || '';
    notebookResultFile.value = '';
    renderReferenceOptions();
    refInstrument.value = existingEntry?.references?.instrumentId || '';
    refPeopleIds.value = formatRefList(existingEntry?.references?.peopleIds);
    refChemicalIds.value = formatRefList(existingEntry?.references?.chemicalIds);
    setMultiSelectValues(refSampleIds, existingEntry?.references?.sampleIds || []);
    refPaperIds.value = formatRefList(existingEntry?.references?.paperIds);
    refReagentLots.value = formatRefList(existingEntry?.references?.reagentLots);
    synthesisProducedCompound.value = existingEntry?.synthesisOutcome?.producedCompoundCode || '';
    synthesisPurity.value = existingEntry?.synthesisOutcome?.purityPercent || '';
    synthesisUsedInAssay.value = existingEntry?.synthesisOutcome?.usedInAssay || '';

    const draft = loadChemistryDraft(project.id, SYNTHESIS_ENTRY_PROTOCOL_KEY);
    synthesisChemistryState = normalizeChemistryState(existingEntry?.synthesisChemistry || draft?.synthesisChemistry);
    chemistryProcedureInput.value = existingEntry?.synthesisProcedure || draft?.synthesisProcedure || '';
    renderSynthesisChemistry();
    updateSaveButtonLabel();
  }

  async function saveEntry() {
    const projectId = notebookProjectSelect.value;
    const project = state.projects.find((item) => item.id === projectId);
    if (!project) {
      return;
    }

    const values = {};
    notebookSteps.querySelectorAll('[data-nb-key]').forEach((input) => {
      values[input.dataset.nbKey] = input.value.trim();
    });

    const editingEntry = editingEntryId
      ? state.notebookEntries.find((item) => item.id === editingEntryId && matchesNotebookType(item))
      : null;

    const entry = {
      id: editingEntry?.id || createId(),
      notebookType,
      projectId: project.id,
      projectName: project.name,
      protocolId: SYNTHESIS_ENTRY_PROTOCOL_KEY,
      protocolName: SYNTHESIS_ENTRY_PROTOCOL_NAME,
      values,
      result: notebookResult.value.trim(),
      resultFiles: Array.from(notebookResultFile.files || []).map((file) => file.name),
      references: {
        instrumentId: refInstrument.value || '',
        peopleIds: readRefValues(refPeopleIds),
        chemicalIds: readRefValues(refChemicalIds),
        sampleIds: readRefValues(refSampleIds),
        paperIds: readRefValues(refPaperIds),
        reagentLots: readRefValues(refReagentLots)
      },
      synthesisOutcome: {
        producedCompoundCode: synthesisProducedCompound.value.trim(),
        purityPercent: synthesisPurity.value.trim(),
        usedInAssay: synthesisUsedInAssay.value.trim()
      },
      chemical: null,
      synthesisChemistry: synthesisChemistryState.enabled
        ? {
          enabled: true,
          phase: synthesisChemistryState.phase,
          finished: synthesisChemistryState.finished,
          substrates: synthesisChemistryState.substrates.map((item) => ({ ...item })),
          product: synthesisChemistryState.product ? { ...synthesisChemistryState.product } : null
        }
        : { enabled: false, substrates: [], product: null, phase: 'substrate', finished: false },
      synthesisProcedure: chemistryProcedureInput?.value.trim() || '',
      storageFolder: editingEntry?.storageFolder || buildNotebookFolderPath(project.name),
      updatedAt: new Date().toISOString()
    };

    await ensureStorageFolderExists(entry.storageFolder);

    const index = editingEntry
      ? state.notebookEntries.findIndex((item) => item.id === editingEntry.id)
      : -1;
    if (index >= 0) {
      state.notebookEntries[index] = { ...state.notebookEntries[index], ...entry };
    } else {
      state.notebookEntries.push(entry);
    }
    editingEntryId = entry.id;
    updateSaveButtonLabel();

    clearChemistryDraft(project.id, SYNTHESIS_ENTRY_PROTOCOL_KEY);
    persist();
    renderEntries();
    if (typeof onNotebookEntriesChanged === 'function') {
      onNotebookEntriesChanged();
    }
  }

  async function ensureStorageFolderExists(storageFolder) {
    if (!storageFolder || !window.enanaApi?.ensureStorageDirectory) {
      return;
    }
    await window.enanaApi.ensureStorageDirectory(storageFolder);
  }

  function renderProjectOptions() {
    const selected = notebookProjectSelect.value;
    const options = ['<option value="">Select project</option>'];

    state.projects.forEach((project) => {
      const isSelected = project.id === selected ? ' selected' : '';
      options.push(`<option value="${project.id}"${isSelected}>${safeText(project.name)}</option>`);
    });

    notebookProjectSelect.innerHTML = options.join('');

    if (selected && state.projects.some((project) => project.id === selected)) {
      notebookProjectSelect.value = selected;
    } else if (state.projects.length) {
      notebookProjectSelect.value = state.projects[0].id;
    }
  }

  function renderProtocolOptions() {
    // Synthesis notebook no longer uses a protocol selector; keep this for renderer API compatibility.
    onProtocolChange();
  }

  function renderEntries() {
    const entries = state.notebookEntries.filter((entry) => matchesNotebookType(entry));

    if (!entries.length) {
      notebookEntryList.innerHTML = '<p class="small-note">No notebook entries saved.</p>';
      return;
    }

    notebookEntryList.innerHTML = entries.map((entry) => {
      const chemistryHtml = buildChemistrySummaryHtml(entry);
      const procedureHtml = entry.synthesisProcedure
        ? `<p><strong>Experiment Procedure:</strong> ${safeText(entry.synthesisProcedure)}</p>`
        : '<p><strong>Experiment Procedure:</strong> -</p>';

      return `
        <details class="list-row list-row-details">
          <summary class="list-main-text">
            ${safeText(entry.projectName || '-')}
            <span class="small-note">Updated: ${new Date(entry.updatedAt).toLocaleString()}</span>
          </summary>
          <div class="stack-form list-detail-content">
            <div class="card-actions">
              <button type="button" class="ghost-btn" data-notebook-edit="${entry.id}">Edit</button>
            </div>
            <p><strong>Notebook Folder:</strong> ${safeText(entry.storageFolder || '-')}</p>
            ${chemistryHtml}
            ${procedureHtml}
            <p><strong>Result File / Notes:</strong> ${safeText(entry.result || '-')}</p>
            <p><strong>Result Files:</strong> ${safeText((entry.resultFiles || []).join(', ') || '-')}</p>
            <p><strong>Linked Instrument:</strong> ${safeText(entry.references?.instrumentId || '-')}</p>
            <p><strong>Linked Reagent Lots:</strong> ${safeText((entry.references?.reagentLots || []).join(', ') || '-')}</p>
            <p><strong>Produced Compound:</strong> ${safeText(entry.synthesisOutcome?.producedCompoundCode || '-')}</p>
            <p><strong>Purity (%):</strong> ${safeText(entry.synthesisOutcome?.purityPercent || '-')}</p>
            <p><strong>Used In Assay:</strong> ${safeText(entry.synthesisOutcome?.usedInAssay || '-')}</p>
          </div>
        </details>
      `;
    }).join('');
  }

  function onEntryListClick(event) {
    const editBtn = event.target.closest('[data-notebook-edit]');
    if (!editBtn) {
      return;
    }
    editEntry(editBtn.dataset.notebookEdit);
  }

  function editEntry(entryId) {
    const entry = state.notebookEntries.find((item) => item.id === entryId && matchesNotebookType(item));
    if (!entry) {
      return;
    }

    editingEntryId = entry.id;
    notebookProjectSelect.value = entry.projectId;
    renderProtocolOptions();
    onProtocolChange();
  }

  function updateSaveButtonLabel() {
    if (!saveNotebookBtn) {
      return;
    }
    const editing = Boolean(editingEntryId);
    saveNotebookBtn.textContent = editing ? 'Update Notebook Entry' : 'Save Notebook Entry';
    if (cancelEditBtn) {
      cancelEditBtn.hidden = !editing;
    }
  }

  function cancelEdit() {
    editingEntryId = null;
    updateSaveButtonLabel();
    onProtocolChange();
  }

  function parseRefList(raw) {
    return String(raw || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }

  function readRefValues(field) {
    if (!field) {
      return [];
    }
    if (field.tagName === 'SELECT' && field.multiple) {
      return Array.from(field.selectedOptions || [])
        .map((option) => String(option.value || '').trim())
        .filter(Boolean);
    }
    return parseRefList(field.value);
  }

  function formatRefList(list) {
    if (!Array.isArray(list) || !list.length) {
      return '';
    }
    return list.join(', ');
  }

  function renderReferenceOptions() {
    if (!refInstrument) {
      return;
    }
    const selected = refInstrument.value;
    const selectedSamples = readRefValues(refSampleIds);
    const options = ['<option value="">Select instrument</option>'];
    (state.instruments || []).forEach((instrument) => {
      const isSelected = selected === instrument.id ? ' selected' : '';
      options.push(`<option value="${safeText(instrument.id)}"${isSelected}>${safeText(instrument.name || instrument.id)}</option>`);
    });
    refInstrument.innerHTML = options.join('');
    if (selected && (state.instruments || []).some((item) => item.id === selected)) {
      refInstrument.value = selected;
    }

    if (refSampleIds) {
      refSampleIds.innerHTML = (state.samples || []).map((sample) => {
        const sampleKey = sample.code || sample.id;
        const label = sample.name ? `${sampleKey} - ${sample.name}` : sampleKey;
        return `<option value="${safeText(sampleKey)}">${safeText(label)}</option>`;
      }).join('');
      setMultiSelectValues(refSampleIds, selectedSamples);
    }
  }

  function setMultiSelectValues(selectEl, values) {
    if (!selectEl) {
      return;
    }
    const selectedValues = Array.isArray(values) ? values.map((item) => String(item || '').trim()).filter(Boolean) : [];
    selectedValues.forEach((value) => {
      if (!Array.from(selectEl.options).some((option) => option.value === value)) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = `${value} (missing)`;
        selectEl.append(option);
      }
    });
    Array.from(selectEl.options).forEach((option) => {
      option.selected = selectedValues.includes(option.value);
    });
  }

  function buildChemistrySummaryHtml(entry) {
    const chemistry = normalizeChemistryState(entry.synthesisChemistry);
    if (!chemistry.enabled) {
      return '<p><strong>Chemicals:</strong> Not added.</p>';
    }

    const substrateParts = chemistry.substrates.map((item) => renderReactionNode(item, `Substrate ${item.index}`));
    const productNode = chemistry.product
      ? renderReactionNode(chemistry.product, 'Product')
      : '<span class="small-note">product</span>';
    const schemeHtml = substrateParts.length
      ? `${substrateParts.join('<span class="reaction-plus"> + </span>')} <span class="reaction-arrow">→</span> ${productNode}`
      : '<span class="small-note">No substrates.</span>';

    const rows = chemistry.substrates.map((item) => {
      const mw = item.mw === '' || item.mw === null || item.mw === undefined ? '-' : safeText(item.mw);
      return `<tr><td>${item.index}</td><td>${mw}</td></tr>`;
    }).join('');

    return `
      <p><strong>Reaction Scheme:</strong></p>
      <div class="reaction-scheme reaction-scheme-summary">${schemeHtml}</div>
      <table class="chem-mw-table">
        <thead>
          <tr><th>Substrate #</th><th>MW</th></tr>
        </thead>
        <tbody>${rows || '<tr><td colspan="2">No substrates.</td></tr>'}</tbody>
      </table>
    `;
  }

  function renderFilledStepText(step, values) {
    const source = String(step?.text || '');
    const placeholders = Array.isArray(step?.placeholders) ? step.placeholders : [];
    const matches = [...source.matchAll(PLACEHOLDER_TOKEN_REGEX)];

    if (!matches.length) {
      if (!placeholders.length) {
        return safeText(source);
      }

      const trailingValues = placeholders.map((placeholder) => {
        const key = `${step.id}:${placeholder.id}`;
        const rawValue = String(values[key] || '').trim();
        return safeText(rawValue || `[${placeholder.name}]`);
      }).join(' ');
      return `${safeText(source)} ${trailingValues}`.trim();
    }

    let cursor = 0;
    let text = '';
    matches.forEach((match) => {
      const index = Number(match.index || 0);
      const placeholderId = match[1];
      const key = `${step.id}:${placeholderId}`;
      const placeholder = placeholders.find((item) => item.id === placeholderId);
      const rawValue = String(values[key] || '').trim();
      text += safeText(source.slice(cursor, index));
      text += safeText(rawValue || `[${placeholder?.name || 'value'}]`);
      cursor = index + match[0].length;
    });

    text += safeText(source.slice(cursor));
    return text;
  }

  function renderStepSentence(step, values) {
    const source = String(step?.text || '');
    const placeholders = Array.isArray(step?.placeholders) ? step.placeholders : [];
    const matches = [...source.matchAll(PLACEHOLDER_TOKEN_REGEX)];

    if (!matches.length) {
      if (!placeholders.length) {
        return safeText(source);
      }
      const trailing = placeholders.map((item) => {
        const key = `${step.id}:${item.id}`;
        return buildInlinePlaceholderHtml(key, item.name, values[key] || '');
      }).join(' ');
      return `${safeText(source)} ${trailing}`.trim();
    }

    let cursor = 0;
    let html = '';

    matches.forEach((match) => {
      const index = Number(match.index || 0);
      const placeholderId = match[1];
      const key = `${step.id}:${placeholderId}`;
      const placeholder = placeholders.find((item) => item.id === placeholderId);
      html += safeText(source.slice(cursor, index));
      html += buildInlinePlaceholderHtml(key, placeholder?.name || 'value', values[key] || '');
      cursor = index + match[0].length;
    });

    html += safeText(source.slice(cursor));
    return html;
  }

  function buildInlinePlaceholderHtml(key, name, value) {
    const cleanName = safeText(name || 'value');
    const cleanValue = safeText(value || '');
    const tokenLabel = cleanValue || `[${cleanName}]`;
    const isEmptyClass = cleanValue ? '' : ' is-empty';

    return `
      <span class="inline-placeholder-wrap" data-inline-placeholder data-placeholder-name="${cleanName}">
        <button type="button" class="inline-placeholder-token${isEmptyClass}" data-inline-token data-nb-key-ref="${safeText(key)}">${tokenLabel}</button>
        <input type="text" class="inline-placeholder-editor" data-inline-input data-nb-key-ref="${safeText(key)}" value="${cleanValue}" placeholder="${cleanName}" hidden />
        <input type="hidden" data-nb-key="${safeText(key)}" value="${cleanValue}" />
      </span>
    `;
  }

  function onInlinePlaceholderClick(event) {
    const token = event.target.closest('[data-inline-token]');
    if (!token) {
      return;
    }

    const wrap = token.closest('[data-inline-placeholder]');
    if (!wrap) {
      return;
    }

    const editor = wrap.querySelector('[data-inline-input]');
    const hiddenValue = wrap.querySelector('[data-nb-key]');
    if (!editor || !hiddenValue) {
      return;
    }

    editor.value = hiddenValue.value || '';
    token.hidden = true;
    editor.hidden = false;
    editor.focus();
    editor.select();
  }

  function onInlinePlaceholderBlur(event) {
    const editor = event.target.closest('[data-inline-input]');
    if (!editor) {
      return;
    }
    commitInlinePlaceholder(editor);
  }

  function onInlinePlaceholderKeydown(event) {
    const editor = event.target.closest('[data-inline-input]');
    if (!editor) {
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      commitInlinePlaceholder(editor);
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      const wrap = editor.closest('[data-inline-placeholder]');
      const hiddenValue = wrap?.querySelector('[data-nb-key]');
      if (hiddenValue) {
        editor.value = hiddenValue.value || '';
      }
      closeInlinePlaceholderEditor(editor);
    }
  }

  function commitInlinePlaceholder(editor) {
    const wrap = editor.closest('[data-inline-placeholder]');
    const hiddenValue = wrap?.querySelector('[data-nb-key]');
    if (!hiddenValue) {
      closeInlinePlaceholderEditor(editor);
      return;
    }

    const cleanValue = editor.value.trim();
    hiddenValue.value = cleanValue;
    closeInlinePlaceholderEditor(editor);
  }

  function closeInlinePlaceholderEditor(editor) {
    const wrap = editor.closest('[data-inline-placeholder]');
    const hiddenValue = wrap?.querySelector('[data-nb-key]');
    const token = wrap?.querySelector('[data-inline-token]');
    if (!wrap || !hiddenValue || !token) {
      return;
    }

    const name = wrap.dataset.placeholderName || 'value';
    const cleanValue = hiddenValue.value || '';
    token.textContent = cleanValue || `[${name}]`;
    token.classList.toggle('is-empty', !cleanValue);
    editor.hidden = true;
    token.hidden = false;
  }

  function createEmptyChemistryState() {
    return {
      enabled: false,
      phase: 'substrate',
      finished: false,
      substrates: [],
      product: null
    };
  }

  function normalizeChemistryState(raw) {
    const empty = createEmptyChemistryState();
    if (!raw || typeof raw !== 'object') {
      return empty;
    }

    return {
      enabled: Boolean(raw.enabled),
      phase: raw.phase === 'product' ? 'product' : 'substrate',
      finished: Boolean(raw.finished),
      substrates: Array.isArray(raw.substrates)
        ? raw.substrates.map((item, index) => ({
          index: Number(item?.index) || index + 1,
          label: String(item?.label || `Substrate ${index + 1}`),
          smiles: String(item?.smiles || ''),
          mw: item?.mw === '' || item?.mw === null || item?.mw === undefined ? '' : String(item.mw),
          pngDataUrl: String(item?.pngDataUrl || ''),
          source: String(item?.source || 'typed')
        }))
        : [],
      product: raw.product
        ? {
          label: String(raw.product.label || 'Product'),
          smiles: String(raw.product.smiles || ''),
          pngDataUrl: String(raw.product.pngDataUrl || ''),
          source: String(raw.product.source || 'typed')
        }
        : null
    };
  }

  function onChemistryToggleChange() {
    synthesisChemistryState.enabled = Boolean(chemistryEnabledToggle?.checked);
    if (!synthesisChemistryState.enabled) {
      synthesisChemistryState = {
        ...createEmptyChemistryState(),
        enabled: false
      };
      setChemistryStatus('Chemical section turned off.', false);
    }
    persistChemistryDraft();
    renderSynthesisChemistry();
  }

  async function onChemistryNext() {
    if (!synthesisChemistryState.enabled) {
      return;
    }

    if (synthesisChemistryState.finished) {
      setChemistryStatus('Reaction is ended. Press Reset to start over.', true);
      return;
    }

    const typedLabel = chemistryInput?.value.trim() || '';

    try {
      setChemistryStatus('Capturing structure from editor...', false);
      const snapshot = await collectStructureSnapshot();

      const label = typedLabel || (synthesisChemistryState.phase === 'product'
        ? 'Product'
        : `Substrate ${synthesisChemistryState.substrates.length + 1}`);

      if (!snapshot.smiles && !typedLabel) {
        setChemistryStatus('Draw a structure or type an abbreviation before Next.', true);
        return;
      }

      if (synthesisChemistryState.phase === 'product') {
        synthesisChemistryState.product = {
          label,
          smiles: snapshot.smiles,
          pngDataUrl: snapshot.pngDataUrl,
          source: snapshot.smiles ? 'drawn' : 'typed'
        };
        setChemistryStatus('Product saved. Press End to complete the reaction.', false);
      } else {
        const substrateIndex = synthesisChemistryState.substrates.length + 1;
        const mw = await estimateMw(snapshot.smiles || typedLabel);

        synthesisChemistryState.substrates.push({
          index: substrateIndex,
          label,
          smiles: snapshot.smiles,
          mw,
          pngDataUrl: snapshot.pngDataUrl,
          source: snapshot.smiles ? 'drawn' : 'typed'
        });

        setChemistryStatus(`Substrate ${substrateIndex} saved. PNG + hidden SMILES captured.`, false);
      }

      if (chemistryInput) {
        chemistryInput.value = '';
      }
      await clearKetcherCanvas();
      persistChemistryDraft();
      renderSynthesisChemistry();
    } catch (error) {
      setChemistryStatus(error?.message || 'Failed to read structure from editor.', true);
    }
  }

  function onChemistryProductMode() {
    if (!synthesisChemistryState.enabled) {
      return;
    }

    if (!synthesisChemistryState.substrates.length) {
      setChemistryStatus('Add at least one substrate before product mode.', true);
      return;
    }

    synthesisChemistryState.phase = 'product';
    synthesisChemistryState.finished = false;
    setChemistryStatus('Product mode enabled. Draw product and press Next.', false);
    persistChemistryDraft();
    renderSynthesisChemistry();
  }

  function onChemistryEnd() {
    if (!synthesisChemistryState.enabled) {
      return;
    }

    if (!synthesisChemistryState.substrates.length) {
      setChemistryStatus('No substrates found. Add substrates before ending.', true);
      return;
    }

    synthesisChemistryState.finished = true;
    setChemistryStatus('Reaction ended. Scheme and MW table ready.', false);
    persistChemistryDraft();
    renderSynthesisChemistry();
  }

  function onChemistryReset() {
    const enabled = Boolean(chemistryEnabledToggle?.checked);
    synthesisChemistryState = createEmptyChemistryState();
    synthesisChemistryState.enabled = enabled;
    if (chemistryInput) {
      chemistryInput.value = '';
    }
    if (chemistryProcedureInput) {
      chemistryProcedureInput.value = '';
    }
    persistChemistryDraft();
    setChemistryStatus('Reaction builder reset.', false);
    renderSynthesisChemistry();
  }

  function onChemistryMwInputChange(event) {
    const input = event.target.closest('[data-substrate-mw-index]');
    if (!input) {
      return;
    }

    const index = Number(input.dataset.substrateMwIndex);
    const target = synthesisChemistryState.substrates.find((item) => item.index === index);
    if (!target) {
      return;
    }

    target.mw = input.value.trim();
    persistChemistryDraft();
  }

  function renderSynthesisChemistry() {
    const enabled = Boolean(synthesisChemistryState.enabled);

    if (chemistryEnabledToggle) {
      chemistryEnabledToggle.checked = enabled;
    }

    if (chemistryWorkflow) {
      chemistryWorkflow.hidden = !enabled;
    }

    if (!enabled) {
      if (chemistryScheme) {
        chemistryScheme.innerHTML = '<span class="small-note">No chemical scheme added.</span>';
      }
      if (chemistryNumbers) {
        chemistryNumbers.innerHTML = '';
      }
      if (chemistryMwTableBody) {
        chemistryMwTableBody.innerHTML = '<tr><td colspan="2">No substrates.</td></tr>';
      }
      return;
    }

    if (chemistryProductBtn) {
      chemistryProductBtn.classList.toggle('calendar-view-active', synthesisChemistryState.phase === 'product');
    }

    const substrateParts = synthesisChemistryState.substrates.map((item) => (
      renderReactionNode(item, `Substrate ${item.index}`)
    ));
    const productLabel = synthesisChemistryState.product
      ? renderReactionNode(synthesisChemistryState.product, 'Product')
      : '<span class="small-note">product</span>';
    const schemeHtml = substrateParts.length
      ? `${substrateParts.join('<span class="reaction-plus"> + </span>')} <span class="reaction-arrow">→</span> <span class="reaction-product">${productLabel}</span>`
      : '<span class="small-note">Add substrates to build reaction scheme.</span>';

    if (chemistryScheme) {
      chemistryScheme.innerHTML = schemeHtml;
    }

    if (chemistryNumbers) {
      chemistryNumbers.innerHTML = synthesisChemistryState.substrates.map((item) => {
        return `<span class="reaction-number">${item.index}</span>`;
      }).join('');
    }

    if (chemistryMwTableBody) {
      chemistryMwTableBody.innerHTML = synthesisChemistryState.substrates.map((item) => {
        return `
          <tr>
            <td>${item.index}</td>
            <td>
              <input data-substrate-mw-index="${item.index}" value="${safeText(item.mw)}" placeholder="Auto / manual MW" />
            </td>
          </tr>
        `;
      }).join('') || '<tr><td colspan="2">No substrates.</td></tr>';
    }
  }

  function setChemistryStatus(message, isError) {
    if (!chemistryStatus) {
      return;
    }
    chemistryStatus.textContent = message;
    chemistryStatus.style.color = isError ? '#982a38' : '';
  }

  async function collectStructureSnapshot() {
    const ketcher = await getKetcherInstance();
    const smiles = String(await ketcher.getSmiles()).trim();
    const molfile = String(await ketcher.getMolfile('v3000')).trim();

    if (!smiles && !molfile) {
      return { smiles: '', pngDataUrl: '' };
    }

    let pngDataUrl = '';
    try {
      const pngBlob = await ketcher.generateImage(molfile || smiles, {
        outputFormat: 'png',
        backgroundColor: '#ffffff',
        bondThickness: 1
      });
      pngDataUrl = await normalizeImagePayload(pngBlob, 'image/png');
    } catch {
      pngDataUrl = '';
    }

    if (!pngDataUrl) {
      try {
        const svgBlob = await ketcher.generateImage(molfile || smiles, {
          outputFormat: 'svg',
          backgroundColor: '#ffffff',
          bondThickness: 1
        });
        pngDataUrl = await normalizeImagePayload(svgBlob, 'image/svg+xml');
      } catch {
        pngDataUrl = '';
      }
    }

    if (!pngDataUrl && smiles) {
      try {
        pngDataUrl = await fetchStructureImageFromPubChem(smiles);
      } catch {
        pngDataUrl = '';
      }
    }

    return { smiles, pngDataUrl };
  }

  async function getKetcherInstance() {
    if (!notebookKetcherFrame || !notebookKetcherFrame.contentWindow) {
      throw new Error('Ketcher frame is not loaded yet.');
    }

    const hostWindow = notebookKetcherFrame.contentWindow;
    let editorFrame = null;

    try {
      editorFrame = hostWindow.document.getElementById('editor');
    } catch {
      throw new Error('Cannot access embedded Ketcher editor.');
    }

    const ketcher = editorFrame?.contentWindow?.ketcher;
    if (!ketcher) {
      throw new Error('Ketcher is still initializing. Try again in a second.');
    }

    return ketcher;
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('Cannot convert image blob to data URL.'));
      reader.readAsDataURL(blob);
    });
  }

  async function normalizeImagePayload(payload, mimeType) {
    if (!payload) {
      return '';
    }
    if (typeof payload === 'string') {
      if (payload.startsWith('data:')) {
        return payload;
      }
      return `data:${mimeType};base64,${payload}`;
    }
    if (payload instanceof Blob) {
      return blobToDataUrl(payload);
    }
    if (payload instanceof ArrayBuffer) {
      return `data:${mimeType};base64,${arrayBufferToBase64(payload)}`;
    }
    if (ArrayBuffer.isView(payload)) {
      return `data:${mimeType};base64,${arrayBufferToBase64(payload.buffer)}`;
    }
    if (payload && typeof payload === 'object') {
      if (payload.data && typeof payload.data === 'string') {
        if (payload.data.startsWith('data:')) {
          return payload.data;
        }
        return `data:${mimeType};base64,${payload.data}`;
      }
      if (payload.blob instanceof Blob) {
        return blobToDataUrl(payload.blob);
      }
    }
    return '';
  }

  async function fetchStructureImageFromPubChem(smiles) {
    const encoded = encodeURIComponent(smiles);
    const url = `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/smiles/${encoded}/PNG?image_size=250x180`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`PubChem image fetch failed (HTTP ${response.status}).`);
    }
    const blob = await response.blob();
    return blobToDataUrl(blob);
  }

  function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i += 1) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  async function clearKetcherCanvas() {
    try {
      const ketcher = await getKetcherInstance();
      await ketcher.setMolecule('');
    } catch {
      // No-op: failing to clear the canvas should not block notebook flow.
    }
  }

  async function estimateMw(query) {
    const clean = String(query || '').trim();
    if (!clean) {
      return '';
    }

    try {
      const lookup = await fetchChemicalLookup(clean);
      if (!lookup?.molecularWeight) {
        return '';
      }
      return String(lookup.molecularWeight);
    } catch {
      return '';
    }
  }

  async function fetchChemicalLookup(query) {
    const fields = 'Title,MolecularFormula,MolecularWeight,CanonicalSMILES,IUPACName,InChIKey';
    const encoded = encodeURIComponent(query);
    const lookupTypes = [
      { key: 'name', label: 'Name' },
      { key: 'smiles', label: 'SMILES' },
      { key: 'inchi', label: 'InChI' }
    ];

    lookupTicket += 1;
    const ticket = lookupTicket;

    for (const lookupType of lookupTypes) {
      const url = `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/${lookupType.key}/${encoded}/property/${fields}/JSON`;
      let response;
      try {
        response = await fetch(url);
      } catch {
        throw new Error('Cannot reach PubChem from this app instance.');
      }

      if (ticket !== lookupTicket) {
        throw new Error('Lookup canceled due to newer request.');
      }

      if (!response.ok) {
        if (response.status === 404 || response.status === 400) {
          continue;
        }
        throw new Error(`PubChem lookup failed (HTTP ${response.status}).`);
      }

      const data = await response.json();
      const property = data?.PropertyTable?.Properties?.[0];
      if (!property) {
        continue;
      }

      currentLookup = {
        query,
        result: {
          matchedBy: lookupType.label,
          cid: property.CID || '',
          title: property.Title || '',
          molecularFormula: property.MolecularFormula || '',
          molecularWeight: property.MolecularWeight || '',
          canonicalSmiles: property.CanonicalSMILES || '',
          iupacName: property.IUPACName || '',
          inchiKey: property.InChIKey || ''
        }
      };

      return currentLookup.result;
    }

    throw new Error('No PubChem match found for this query.');
  }

  function matchesNotebookType(entry) {
    if (entry?.notebookType) {
      return entry.notebookType === notebookType;
    }
    return notebookType === 'synthesis';
  }

  function renderReactionNode(item, fallbackLabel) {
    const label = safeText(item?.label || fallbackLabel || 'Compound');
    const imageData = String(item?.pngDataUrl || '').trim();
    if (!imageData) {
      return `<span class="reaction-part">${label}</span>`;
    }

    return `
      <span class="reaction-node">
        <img class="reaction-structure-image" src="${imageData}" alt="${label}" />
        <span class="reaction-node-label">${label}</span>
      </span>
    `;
  }

  function persistChemistryDraft() {
    const projectId = notebookProjectSelect.value;
    const protocolId = SYNTHESIS_ENTRY_PROTOCOL_KEY;
    if (!projectId || !protocolId) {
      return;
    }

    const drafts = readChemistryDrafts();
    const key = `${projectId}:${protocolId}`;
    drafts[key] = {
      synthesisChemistry: {
        enabled: synthesisChemistryState.enabled,
        phase: synthesisChemistryState.phase,
        finished: synthesisChemistryState.finished,
        substrates: synthesisChemistryState.substrates.map((item) => ({ ...item })),
        product: synthesisChemistryState.product ? { ...synthesisChemistryState.product } : null
      },
      synthesisProcedure: chemistryProcedureInput?.value.trim() || ''
    };
    writeChemistryDrafts(drafts);
  }

  function loadChemistryDraft(projectId, protocolId) {
    if (!projectId || !protocolId) {
      return null;
    }
    const drafts = readChemistryDrafts();
    return drafts[`${projectId}:${protocolId}`] || null;
  }

  function clearChemistryDraft(projectId, protocolId) {
    if (!projectId || !protocolId) {
      return;
    }
    const drafts = readChemistryDrafts();
    delete drafts[`${projectId}:${protocolId}`];
    writeChemistryDrafts(drafts);
  }

  function readChemistryDrafts() {
    if (!state.synthesisChemistryDrafts || typeof state.synthesisChemistryDrafts !== 'object') {
      state.synthesisChemistryDrafts = {};
    }
    return state.synthesisChemistryDrafts;
  }

  function writeChemistryDrafts(drafts) {
    state.synthesisChemistryDrafts = drafts && typeof drafts === 'object' ? drafts : {};
    persist();
  }

  return { renderProjectOptions, renderProtocolOptions, renderEntries, onProtocolChange };
}
