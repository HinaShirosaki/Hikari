export function initSampleRegistry({ state, persist, safeText }) {
  const sampleForm = document.getElementById('sample-form');
  const sampleIdInput = document.getElementById('sample-id');
  const sampleCodeInput = document.getElementById('sample-code');
  const sampleNameInput = document.getElementById('sample-name');
  const sampleTypeInput = document.getElementById('sample-type');
  const sampleLotInput = document.getElementById('sample-lot');
  const sampleConcentrationInput = document.getElementById('sample-concentration');
  const sampleStorageTypeInput = document.getElementById('sample-storage-type');
  const sampleLinkContainerInput = document.getElementById('sample-link-container');
  const sampleLinkPositionInput = document.getElementById('sample-link-position');
  const sampleLinkChemicalsInput = document.getElementById('sample-link-chemicals');
  const sampleLocationFields = document.getElementById('sample-location-fields');
  const sampleNotesInput = document.getElementById('sample-notes');
  const sampleCellPassageFields = document.getElementById('sample-cell-passage-fields');
  const samplePassageLastDateInput = document.getElementById('sample-passage-last-date');
  const samplePassageIntervalDaysInput = document.getElementById('sample-passage-interval-days');
  const sampleCompoundFields = document.getElementById('sample-compound-fields');
  const sampleCompoundOpenBtn = document.getElementById('sample-compound-open-btn');
  const sampleCompoundCaptureBtn = document.getElementById('sample-compound-capture-btn');
  const sampleCompoundClearBtn = document.getElementById('sample-compound-clear-btn');
  const sampleCompoundSmilesInput = document.getElementById('sample-compound-smiles');
  const sampleCompoundStatus = document.getElementById('sample-compound-status');
  const sampleCompoundEditorWrap = document.getElementById('sample-compound-editor-wrap');
  const sampleCompoundKetcherFrame = document.getElementById('sample-compound-ketcher-frame');
  const sampleCancelBtn = document.getElementById('sample-cancel-btn');
  const sampleSearchInput = document.getElementById('sample-search');
  const sampleRegistryList = document.getElementById('sample-registry-list');
  let compoundEditorOpen = false;
  let compoundStructureDraft = emptyCompoundStructureDraft();

  sampleStorageTypeInput?.addEventListener('change', renderLocationFields);
  sampleLinkContainerInput?.addEventListener('change', onLinkedContainerChange);
  sampleTypeInput?.addEventListener('change', onSampleTypeChange);
  sampleCompoundOpenBtn?.addEventListener('click', onCompoundOpenClick);
  sampleCompoundCaptureBtn?.addEventListener('click', onCompoundCaptureClick);
  sampleCompoundClearBtn?.addEventListener('click', onCompoundClearClick);
  sampleForm?.addEventListener('submit', onSubmit);
  sampleCancelBtn?.addEventListener('click', resetForm);
  sampleSearchInput?.addEventListener('input', renderList);
  sampleRegistryList?.addEventListener('click', onListClick);

  function ensureState() {
    if (!Array.isArray(state.samples)) {
      state.samples = [];
    }
  }

  function makeDefaultCode() {
    return `S-${Date.now().toString().slice(-6)}`;
  }

  function buildInventoryContainerOptions() {
    const options = ['<option value="">Not linked</option>'];
    Object.entries(state.inventory || {}).forEach(([section, containers]) => {
      (containers || []).forEach((container) => {
        const value = `${section}::${container.id}`;
        const label = `${section} / ${container.name}`;
        options.push(`<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`);
      });
    });
    return options.join('');
  }

  function findLinkedContainer(linkedContainerValue) {
    const raw = String(linkedContainerValue || '');
    if (!raw.includes('::')) {
      return null;
    }
    const [section, containerId] = raw.split('::');
    if (!section || !containerId) {
      return null;
    }
    const container = (state.inventory?.[section] || []).find((item) => item.id === containerId);
    if (!container) {
      return null;
    }
    return { section, containerId, container };
  }

  function renderLinkedPositionOptions() {
    if (!sampleLinkPositionInput) {
      return;
    }
    const selected = sampleLinkPositionInput.value;
    const linked = findLinkedContainer(sampleLinkContainerInput?.value);
    const options = ['<option value="">Auto / none</option>'];
    if (linked) {
      if ((linked.container.type || 'box81') === 'box81') {
        (linked.container.wells || []).forEach((rawWell, index) => {
          const wellName = rawWell && typeof rawWell === 'object'
            ? String(rawWell.name || `W${index + 1}`)
            : `W${index + 1}`;
          options.push(`<option value="${index}">${escapeHtml(`${index + 1} - ${wellName}`)}</option>`);
        });
      } else {
        options.push('<option value="single">Single slot</option>');
      }
    }
    sampleLinkPositionInput.innerHTML = options.join('');
    if (selected && Array.from(sampleLinkPositionInput.options).some((option) => option.value === selected)) {
      sampleLinkPositionInput.value = selected;
    }
  }

  function renderLinkedContainerOptions() {
    if (!sampleLinkContainerInput) {
      return;
    }
    const selectedContainer = sampleLinkContainerInput.value;
    sampleLinkContainerInput.innerHTML = buildInventoryContainerOptions();
    if (selectedContainer && Array.from(sampleLinkContainerInput.options).some((option) => option.value === selectedContainer)) {
      sampleLinkContainerInput.value = selectedContainer;
    }
    renderLinkedPositionOptions();
  }

  function renderChemicalLinkOptions() {
    if (!sampleLinkChemicalsInput) {
      return;
    }
    const selected = Array.from(sampleLinkChemicalsInput.selectedOptions || [])
      .map((option) => option.value)
      .filter(Boolean);
    sampleLinkChemicalsInput.innerHTML = (state.labInventory?.chemicals || []).map((chemical) => {
      const label = `${chemical.name} (${chemical.casNumber})`;
      return `<option value="${escapeHtml(chemical.id)}">${escapeHtml(label)}</option>`;
    }).join('');
    setMultiSelectValues(sampleLinkChemicalsInput, selected);
  }

  function onLinkedContainerChange() {
    renderLinkedPositionOptions();
  }

  function normalizeCode(value) {
    return String(value || '')
      .trim()
      .replace(/\s+/g, '-')
      .replace(/[^a-zA-Z0-9._-]/g, '');
  }

  function renderLocationFields() {
    const type = sampleStorageTypeInput?.value || 'freezer';

    if (type === 'freezer') {
      sampleLocationFields.innerHTML = `
        <label>
          Freezer
          <input id="sample-loc-freezer" placeholder="e.g. -80 Freezer #1" />
        </label>
        <label>
          Rack
          <input id="sample-loc-rack" placeholder="e.g. Rack 3" />
        </label>
        <label>
          Box
          <input id="sample-loc-box" placeholder="e.g. Box B2" />
        </label>
        <label>
          Position
          <input id="sample-loc-position" placeholder="e.g. A7" />
        </label>
      `;
      return;
    }

    if (type === 'fridge') {
      sampleLocationFields.innerHTML = `
        <label>
          Fridge
          <input id="sample-loc-fridge" placeholder="e.g. 4C Fridge A" />
        </label>
        <label>
          Shelf
          <input id="sample-loc-shelf" placeholder="e.g. Shelf 2" />
        </label>
      `;
      return;
    }

    if (type === 'desiccator') {
      sampleLocationFields.innerHTML = `
        <label>
          Desiccator
          <input id="sample-loc-desiccator" placeholder="e.g. Desiccator 1" />
        </label>
        <label>
          Position
          <input id="sample-loc-desiccator-position" placeholder="e.g. Tray B" />
        </label>
      `;
      return;
    }

    sampleLocationFields.innerHTML = `
      <label>
        RT Cabinet
        <input id="sample-loc-cabinet" placeholder="e.g. RT Cabinet 2" />
      </label>
      <label>
        Shelf / Drawer
        <input id="sample-loc-cabinet-slot" placeholder="e.g. Drawer 4" />
      </label>
    `;
  }

  function readLocation() {
    const type = sampleStorageTypeInput?.value || 'freezer';
    if (type === 'freezer') {
      return {
        storageType: type,
        freezer: document.getElementById('sample-loc-freezer')?.value.trim() || '',
        rack: document.getElementById('sample-loc-rack')?.value.trim() || '',
        box: document.getElementById('sample-loc-box')?.value.trim() || '',
        position: document.getElementById('sample-loc-position')?.value.trim() || ''
      };
    }
    if (type === 'fridge') {
      return {
        storageType: type,
        fridge: document.getElementById('sample-loc-fridge')?.value.trim() || '',
        shelf: document.getElementById('sample-loc-shelf')?.value.trim() || ''
      };
    }
    if (type === 'desiccator') {
      return {
        storageType: type,
        desiccator: document.getElementById('sample-loc-desiccator')?.value.trim() || '',
        position: document.getElementById('sample-loc-desiccator-position')?.value.trim() || ''
      };
    }
    return {
      storageType: type,
      cabinet: document.getElementById('sample-loc-cabinet')?.value.trim() || '',
      slot: document.getElementById('sample-loc-cabinet-slot')?.value.trim() || ''
    };
  }

  function fillLocation(location) {
    sampleStorageTypeInput.value = location?.storageType || 'freezer';
    renderLocationFields();

    const type = sampleStorageTypeInput.value;
    if (type === 'freezer') {
      document.getElementById('sample-loc-freezer').value = location?.freezer || '';
      document.getElementById('sample-loc-rack').value = location?.rack || '';
      document.getElementById('sample-loc-box').value = location?.box || '';
      document.getElementById('sample-loc-position').value = location?.position || '';
      return;
    }
    if (type === 'fridge') {
      document.getElementById('sample-loc-fridge').value = location?.fridge || '';
      document.getElementById('sample-loc-shelf').value = location?.shelf || '';
      return;
    }
    if (type === 'desiccator') {
      document.getElementById('sample-loc-desiccator').value = location?.desiccator || '';
      document.getElementById('sample-loc-desiccator-position').value = location?.position || '';
      return;
    }
    document.getElementById('sample-loc-cabinet').value = location?.cabinet || '';
    document.getElementById('sample-loc-cabinet-slot').value = location?.slot || '';
  }

  function formatLocation(location) {
    if (!location || typeof location !== 'object') {
      return '-';
    }
    if (location.storageType === 'freezer') {
      return [location.freezer, location.rack, location.box, location.position].filter(Boolean).join(' -> ') || '-';
    }
    if (location.storageType === 'fridge') {
      return [location.fridge, location.shelf].filter(Boolean).join(' -> ') || '-';
    }
    if (location.storageType === 'desiccator') {
      return [location.desiccator, location.position].filter(Boolean).join(' -> ') || '-';
    }
    return [location.cabinet, location.slot].filter(Boolean).join(' -> ') || '-';
  }

  function normalizeCellPassage(rawValue) {
    const dateValue = String(rawValue?.lastPassageDate || '').trim();
    const interval = Math.round(Number(rawValue?.intervalDays));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateValue) || !Number.isFinite(interval) || interval <= 0) {
      return null;
    }
    return {
      lastPassageDate: dateValue,
      intervalDays: interval
    };
  }

  function readCellPassage() {
    const normalized = normalizeCellPassage({
      lastPassageDate: samplePassageLastDateInput?.value,
      intervalDays: samplePassageIntervalDaysInput?.value
    });
    return normalized;
  }

  function fillCellPassage(cellPassage) {
    const normalized = normalizeCellPassage(cellPassage);
    if (samplePassageLastDateInput) {
      samplePassageLastDateInput.value = normalized?.lastPassageDate || '';
    }
    if (samplePassageIntervalDaysInput) {
      samplePassageIntervalDaysInput.value = normalized?.intervalDays ? String(normalized.intervalDays) : '';
    }
  }

  function formatCellPassage(cellPassage) {
    const normalized = normalizeCellPassage(cellPassage);
    if (!normalized) {
      return 'Unconfigured';
    }
    return `Last: ${normalized.lastPassageDate} | Every ${normalized.intervalDays} day(s)`;
  }

  async function onSubmit(event) {
    event.preventDefault();
    ensureState();

    const name = sampleNameInput.value.trim();
    const code = normalizeCode(sampleCodeInput.value) || makeDefaultCode();
    if (!name) {
      return;
    }

    const editingId = sampleIdInput.value;
    const existing = state.samples.find((item) => item.id === editingId);
    const duplicateCode = state.samples.find((item) => item.code === code && item.id !== editingId);
    if (duplicateCode) {
      return;
    }

    const linkedContainer = findLinkedContainer(sampleLinkContainerInput?.value);
    const linkedPosition = String(sampleLinkPositionInput?.value || '').trim();
    const chemicalLinks = Array.from(sampleLinkChemicalsInput?.selectedOptions || [])
      .map((option) => option.value)
      .filter(Boolean);
    const autoLocation = buildLocationFromInventoryLink(linkedContainer, linkedPosition);
    const manualLocation = readLocation();
    const sampleType = sampleTypeInput.value;
    const isCompound = sampleType === 'compound';
    const isCellLine = sampleType === 'cell_line';

    if (isCompound) {
      try {
        await captureCompoundStructureFromEditor();
      } catch {
        setCompoundStatus('Ketcher is not ready. Saving sample with last captured structure.', true);
      }
    } else {
      compoundStructureDraft = emptyCompoundStructureDraft();
    }

    const resolvedStructure = isCompound
      ? normalizeCompoundStructureData({
        ...existing?.compoundStructure,
        ...compoundStructureDraft
      })
      : null;

    const record = {
      id: existing?.id || `sample-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
      code,
      name,
      type: sampleType,
      lot: sampleLotInput.value.trim(),
      concentration: sampleConcentrationInput.value.trim(),
      notes: sampleNotesInput.value.trim(),
      cellPassage: isCellLine ? readCellPassage() : null,
      location: isEmptyLocation(manualLocation) && autoLocation ? autoLocation : manualLocation,
      inventoryLink: linkedContainer
        ? {
          section: linkedContainer.section,
          containerId: linkedContainer.containerId,
          wellIndex: linkedPosition === '' || linkedPosition === 'single' ? null : Number(linkedPosition)
        }
        : null,
      chemicalLinks,
      compoundStructure: resolvedStructure,
      updatedAt: new Date().toISOString()
    };

    const index = state.samples.findIndex((item) => item.id === record.id);
    if (index >= 0) {
      state.samples[index] = record;
    } else {
      state.samples.push(record);
    }

    persist();
    resetForm();
    renderList();
  }

  function resetForm() {
    sampleIdInput.value = '';
    sampleForm.reset();
    sampleStorageTypeInput.value = 'freezer';
    compoundEditorOpen = false;
    compoundStructureDraft = emptyCompoundStructureDraft();
    renderLinkedContainerOptions();
    renderChemicalLinkOptions();
    if (sampleLinkPositionInput) {
      sampleLinkPositionInput.value = '';
    }
    renderLocationFields();
    fillCellPassage(null);
    renderCellPassageFields();
    renderCompoundFields();
    clearCompoundCanvas().catch(() => {});
  }

  function onListClick(event) {
    const editBtn = event.target.closest('[data-sample-edit]');
    if (editBtn) {
      editSample(editBtn.dataset.sampleEdit);
      return;
    }

    const deleteBtn = event.target.closest('[data-sample-delete]');
    if (deleteBtn) {
      deleteSample(deleteBtn.dataset.sampleDelete);
    }
  }

  function editSample(sampleId) {
    const sample = (state.samples || []).find((item) => item.id === sampleId);
    if (!sample) {
      return;
    }
    sampleIdInput.value = sample.id;
    sampleCodeInput.value = sample.code || '';
    sampleNameInput.value = sample.name || '';
    sampleTypeInput.value = sample.type || 'plasmid';
    sampleLotInput.value = sample.lot || '';
    sampleConcentrationInput.value = sample.concentration || '';
    sampleNotesInput.value = sample.notes || '';
    compoundEditorOpen = false;
    compoundStructureDraft = toCompoundStructureDraft(sample.compoundStructure);
    renderLinkedContainerOptions();
    renderChemicalLinkOptions();
    sampleLinkContainerInput.value = sample.inventoryLink
      ? `${sample.inventoryLink.section}::${sample.inventoryLink.containerId}`
      : '';
    renderLinkedPositionOptions();
    if (sampleLinkPositionInput) {
      sampleLinkPositionInput.value = sample.inventoryLink?.wellIndex === null || sample.inventoryLink?.wellIndex === undefined
        ? (sample.inventoryLink ? 'single' : '')
        : String(sample.inventoryLink.wellIndex);
    }
    setMultiSelectValues(sampleLinkChemicalsInput, sample.chemicalLinks || []);
    fillLocation(sample.location || {});
    fillCellPassage(sample.cellPassage);
    renderCellPassageFields();
    renderCompoundFields();
  }

  function deleteSample(sampleId) {
    state.samples = (state.samples || []).filter((item) => item.id !== sampleId);
    persist();
    renderList();
  }

  function matchesSearch(sample, term) {
    if (!term) {
      return true;
    }
    const haystack = [
      sample.code,
      sample.name,
      sample.type,
      sample.lot,
      sample.concentration,
      sample.cellPassage?.lastPassageDate,
      sample.cellPassage?.intervalDays,
      formatLocation(sample.location),
      formatInventoryLink(sample.inventoryLink),
      sample.notes,
      sample.compoundStructure?.smiles
    ].join(' ').toLowerCase();
    return haystack.includes(term);
  }

  function renderList() {
    ensureState();
    const term = String(sampleSearchInput?.value || '').trim().toLowerCase();
    const rows = state.samples
      .slice()
      .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
      .filter((item) => matchesSearch(item, term));

    if (!rows.length) {
      sampleRegistryList.innerHTML = '<p class="small-note">No samples found.</p>';
      return;
    }

    sampleRegistryList.innerHTML = rows.map((sample) => `
      <article class="card">
        <h3>${safeText(sample.code || sample.id)} - ${safeText(sample.name)}</h3>
        <p><strong>Type:</strong> ${safeText(sample.type || '-')}</p>
        <p><strong>Lot/Batch:</strong> ${safeText(sample.lot || '-')}</p>
        <p><strong>Concentration:</strong> ${safeText(sample.concentration || '-')}</p>
        ${sample.type === 'cell_line' ? `<p><strong>Passage:</strong> ${safeText(formatCellPassage(sample.cellPassage))}</p>` : ''}
        <p><strong>Location:</strong> ${safeText(formatLocation(sample.location))}</p>
        <p><strong>Inventory Link:</strong> ${safeText(formatInventoryLink(sample.inventoryLink))}</p>
        <p><strong>Chemical Links:</strong> ${safeText(formatChemicalLinks(sample.chemicalLinks))}</p>
        ${sample.type === 'compound' ? `<p><strong>Structure:</strong> ${safeText(formatCompoundStructureSummary(sample.compoundStructure))}</p>` : ''}
        <p><strong>Updated:</strong> ${new Date(sample.updatedAt).toLocaleString()}</p>
        <p><strong>Notes:</strong> ${safeText(sample.notes || '-')}</p>
        <div class="card-actions">
          <button type="button" class="ghost-btn" data-sample-edit="${sample.id}">Edit</button>
          <button type="button" class="danger-btn" data-sample-delete="${sample.id}">Delete</button>
        </div>
      </article>
    `).join('');
  }

  function render() {
    ensureState();
    renderLinkedContainerOptions();
    renderChemicalLinkOptions();
    if (!sampleLocationFields.innerHTML.trim()) {
      renderLocationFields();
    }
    renderCellPassageFields();
    renderCompoundFields();
    renderList();
  }

  function onSampleTypeChange() {
    renderCellPassageFields();
    if (sampleTypeInput?.value !== 'compound') {
      compoundEditorOpen = false;
      renderCompoundFields();
      return;
    }
    setCompoundStatus('Compound mode enabled. Open Ketcher to draw structure.', false);
    renderCompoundFields();
  }

  function renderCellPassageFields() {
    if (!sampleCellPassageFields) {
      return;
    }
    const isCellLine = sampleTypeInput?.value === 'cell_line';
    sampleCellPassageFields.hidden = !isCellLine;
    if (!isCellLine) {
      fillCellPassage(null);
    }
  }

  async function onCompoundOpenClick() {
    compoundEditorOpen = !compoundEditorOpen;
    renderCompoundFields();
    if (!compoundEditorOpen) {
      return;
    }
    if (compoundStructureDraft.molfile || compoundStructureDraft.smiles) {
      try {
        const ketcher = await getCompoundKetcher();
        await ketcher.setMolecule(compoundStructureDraft.molfile || compoundStructureDraft.smiles);
      } catch {
        setCompoundStatus('Ketcher is still loading.', true);
      }
    }
  }

  async function onCompoundCaptureClick() {
    if (sampleTypeInput?.value !== 'compound') {
      return;
    }
    try {
      await captureCompoundStructureFromEditor();
      setCompoundStatus(compoundStructureDraft.smiles ? 'Structure captured from Ketcher.' : 'No structure detected on canvas.', false);
    } catch {
      setCompoundStatus('Cannot read Ketcher yet. Open editor and try again.', true);
    }
  }

  async function onCompoundClearClick() {
    compoundStructureDraft = emptyCompoundStructureDraft();
    renderCompoundFields();
    await clearCompoundCanvas();
    setCompoundStatus('Compound structure cleared.', false);
  }

  function renderCompoundFields() {
    if (!sampleCompoundFields) {
      return;
    }
    const isCompound = sampleTypeInput?.value === 'compound';
    sampleCompoundFields.hidden = !isCompound;
    if (!isCompound) {
      setCompoundStatus('', false);
      return;
    }

    if (sampleCompoundSmilesInput) {
      sampleCompoundSmilesInput.value = compoundStructureDraft.smiles || '';
    }
    if (sampleCompoundEditorWrap) {
      sampleCompoundEditorWrap.hidden = !compoundEditorOpen;
    }
    if (sampleCompoundOpenBtn) {
      sampleCompoundOpenBtn.textContent = compoundEditorOpen ? 'Hide Ketcher' : 'Open Ketcher';
    }
  }

  async function captureCompoundStructureFromEditor() {
    if (sampleTypeInput?.value !== 'compound') {
      return;
    }
    const ketcher = await getCompoundKetcher();
    const smiles = String(await ketcher.getSmiles()).trim();
    const molfile = String(await ketcher.getMolfile('v3000')).trim();
    compoundStructureDraft = toCompoundStructureDraft({ smiles, molfile });
    renderCompoundFields();
  }

  async function getCompoundKetcher() {
    if (!sampleCompoundKetcherFrame || !sampleCompoundKetcherFrame.contentWindow) {
      throw new Error('Ketcher frame not loaded.');
    }
    let editorFrame = null;
    try {
      editorFrame = sampleCompoundKetcherFrame.contentWindow.document.getElementById('editor');
    } catch {
      throw new Error('Cannot access Ketcher host frame.');
    }
    const ketcher = editorFrame?.contentWindow?.ketcher;
    if (!ketcher) {
      throw new Error('Ketcher is still initializing.');
    }
    return ketcher;
  }

  async function clearCompoundCanvas() {
    try {
      const ketcher = await getCompoundKetcher();
      await ketcher.setMolecule('');
    } catch {
      // Ignore clear errors. The local draft is already reset.
    }
  }

  function setCompoundStatus(message, isError) {
    if (!sampleCompoundStatus) {
      return;
    }
    sampleCompoundStatus.textContent = String(message || '');
    sampleCompoundStatus.style.color = isError ? '#982a38' : '';
  }

  function normalizeCompoundStructureData(input) {
    const smiles = String(input?.smiles || '').trim();
    const molfile = String(input?.molfile || '').trim();
    if (!smiles && !molfile) {
      return null;
    }
    return { smiles, molfile };
  }

  function toCompoundStructureDraft(input) {
    return {
      smiles: String(input?.smiles || '').trim(),
      molfile: String(input?.molfile || '').trim()
    };
  }

  function emptyCompoundStructureDraft() {
    return { smiles: '', molfile: '' };
  }

  function formatCompoundStructureSummary(structure) {
    const normalized = normalizeCompoundStructureData(structure);
    if (!normalized) {
      return '-';
    }
    if (normalized.smiles) {
      return normalized.smiles;
    }
    return 'Molfile only';
  }

  function buildLocationFromInventoryLink(linkedContainer, linkedPosition) {
    if (!linkedContainer) {
      return null;
    }
    const section = linkedContainer.section;
    const container = linkedContainer.container;
    if (section === '4 Degree') {
      return {
        storageType: 'fridge',
        fridge: '4 Degree',
        shelf: container.name || ''
      };
    }
    if (section === 'Room Temp') {
      return {
        storageType: 'rt_cabinet',
        cabinet: 'Room Temp',
        slot: container.name || ''
      };
    }
    return {
      storageType: 'freezer',
      freezer: section,
      rack: '',
      box: container.name || '',
      position: linkedPosition === '' || linkedPosition === 'single'
        ? ''
        : String(Number(linkedPosition) + 1)
    };
  }

  function isEmptyLocation(location) {
    if (!location || typeof location !== 'object') {
      return true;
    }
    return Object.entries(location)
      .filter(([key]) => key !== 'storageType')
      .every(([, value]) => !String(value || '').trim());
  }

  function formatInventoryLink(link) {
    if (!link) {
      return '-';
    }
    const container = (state.inventory?.[link.section] || []).find((item) => item.id === link.containerId);
    if (!container) {
      return `${link.section || '-'} / missing container`;
    }
    if (link.wellIndex === null || link.wellIndex === undefined) {
      return `${link.section} / ${container.name}`;
    }
    const rawWell = container.wells?.[link.wellIndex];
    const wellName = rawWell && typeof rawWell === 'object'
      ? (rawWell.name || `W${Number(link.wellIndex) + 1}`)
      : `W${Number(link.wellIndex) + 1}`;
    return `${link.section} / ${container.name} / ${wellName}`;
  }

  function formatChemicalLinks(chemicalLinks) {
    const links = Array.isArray(chemicalLinks) ? chemicalLinks : [];
    if (!links.length) {
      return '-';
    }
    return links.map((id) => {
      const item = (state.labInventory?.chemicals || []).find((chemical) => chemical.id === id);
      return item ? item.name : `${id} (missing)`;
    }).join(', ');
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

  function escapeHtml(text) {
    return String(text || '').replace(/[&<>"']/g, (char) => {
      const entityMap = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
      };
      return entityMap[char] || char;
    });
  }

  return { render, renderList };
}
