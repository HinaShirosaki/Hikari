import { createDefaultWells, normalizeCustomGridDimensions } from './constants.js';
import { createPersonalInventoryStateHelpers } from './state.js';
import { createPersonalInventoryDetailRenderer } from './detail-rendering.js';

export function initPersonalInventory({
  state,
  persist,
  createId,
  safeText,
  onSamplesChanged,
  onInventoryChanged
}) {
  const inventorySections = document.getElementById('inventory-sections');
  const inventoryLocationNav = document.getElementById('inventory-location-nav');
  const inventorySummaryCard = document.getElementById('inventory-summary-card');
  const addContainerBtn = document.getElementById('inventory-add-container-btn');
  const addContainerForm = document.getElementById('inventory-add-container-form');
  const addContainerNameInput = document.getElementById('inventory-add-container-name');
  const addContainerLocationSelect = document.getElementById('inventory-add-container-location');
  const addContainerTypeSelect = document.getElementById('inventory-add-container-type');
  const addContainerGridFields = document.getElementById('inventory-add-container-grid-fields');
  const addContainerRowsInput = document.getElementById('inventory-add-container-rows');
  const addContainerColsInput = document.getElementById('inventory-add-container-cols');
  const addContainerCancelBtn = document.getElementById('inventory-add-container-cancel');
  const sampleCompoundDialogOverlay = document.getElementById('sample-compound-dialog-overlay');
  const sampleCompoundDialogCloseBtn = document.getElementById('sample-compound-dialog-close-btn');
  const sampleCompoundDialogCancelBtn = document.getElementById('sample-compound-dialog-cancel-btn');
  const sampleCompoundDialogApplyBtn = document.getElementById('sample-compound-dialog-apply-btn');
  const sampleCompoundKetcherFrame = document.getElementById('sample-compound-ketcher-frame');

  const uiState = {
    selectedContainer: null,
    selectedSectionName: '',
    editingWellIndex: null,
    editingSampleId: '',
    wellEditorStatus: '',
    isAddContainerFormOpen: false,
    shouldAutoOpenContainer: true
  };

  const helpers = createPersonalInventoryStateHelpers({ state, safeText, uiState });
  const { renderContainerDetail } = createPersonalInventoryDetailRenderer({ safeText, uiState, helpers });
  const pendingStructureDrafts = new Map();
  let structureEditorContext = null;

  function notifySamplesChanged() {
    if (typeof onSamplesChanged === 'function') {
      onSamplesChanged();
    }
  }

  function notifyInventoryChanged() {
    if (typeof onInventoryChanged === 'function') {
      onInventoryChanged();
    }
  }

  function isChemicalSampleType(type) {
    return helpers.normalizeSampleType(type) === 'chemical';
  }

  function normalizeStructureData(input) {
    const smiles = String(input?.smiles || '').trim();
    const molfile = String(input?.molfile || '').trim();
    const imageDataUrl = String(input?.imageDataUrl || '').trim();
    if (!smiles && !molfile && !imageDataUrl) {
      return null;
    }
    return { smiles, molfile, imageDataUrl };
  }

  function toStructureDraft(input) {
    return {
      smiles: String(input?.smiles || '').trim(),
      molfile: String(input?.molfile || '').trim(),
      imageDataUrl: String(input?.imageDataUrl || '').trim()
    };
  }

  function getPendingStructureKey(mode) {
    const section = uiState.selectedContainer?.section || '';
    const containerId = uiState.selectedContainer?.containerId || '';
    const slot = mode === 'single-new' ? 'single' : `well-${Number(uiState.editingWellIndex)}`;
    return `${section}::${containerId}::${slot}`;
  }

  function getStructureTypeInput(mode) {
    const selectors = {
      'well-existing': '[data-well-sample-type]',
      'well-new': '[data-well-sample-new-type]',
      'single-existing': '[data-single-sample-type]',
      'single-new': '[data-single-sample-new-type]'
    };
    const selector = selectors[mode];
    return selector ? inventorySections?.querySelector(selector) : null;
  }

  function setStructureStatus(message) {
    const status = inventorySections?.querySelector('[data-inventory-sample-structure-status]');
    if (status) {
      status.textContent = String(message || '');
    }
  }

  function syncStructureButtons() {
    inventorySections?.querySelectorAll('[data-inventory-sample-structure-open]').forEach((button) => {
      const mode = String(button.dataset.inventorySampleStructureOpen || '');
      const typeInput = getStructureTypeInput(mode);
      const isChemical = isChemicalSampleType(typeInput?.value);
      button.hidden = !isChemical;
      if (isChemical) {
        const sample = button.dataset.sampleId ? helpers.getSampleById(button.dataset.sampleId) : null;
        const draft = sample
          ? normalizeStructureData(sample.compoundStructure)
          : normalizeStructureData(pendingStructureDrafts.get(getPendingStructureKey(mode)));
        button.textContent = draft ? 'Edit Structure' : 'Add Structure';
      }
    });
  }

  function openStructureDialog() {
    if (sampleCompoundDialogOverlay) {
      sampleCompoundDialogOverlay.hidden = false;
    }
  }

  function closeStructureDialog() {
    structureEditorContext = null;
    if (sampleCompoundDialogOverlay) {
      sampleCompoundDialogOverlay.hidden = true;
    }
  }

  async function getKetcherInstance() {
    if (!sampleCompoundKetcherFrame || !sampleCompoundKetcherFrame.contentWindow) {
      throw new Error('Ketcher frame is not loaded yet.');
    }
    let editorFrame = null;
    try {
      editorFrame = sampleCompoundKetcherFrame.contentWindow.document.getElementById('editor');
    } catch {
      throw new Error('Cannot access embedded Ketcher editor.');
    }
    const ketcher = editorFrame?.contentWindow?.ketcher;
    if (!ketcher) {
      throw new Error('Ketcher is still initializing.');
    }
    return ketcher;
  }

  async function syncStructureDraftToEditor(draft) {
    const molecule = draft?.molfile || draft?.smiles || '';
    for (let attempt = 0; attempt < 10; attempt += 1) {
      try {
        const ketcher = await getKetcherInstance();
        await ketcher.setMolecule(molecule);
        return true;
      } catch {
        await delay(180);
      }
    }
    return false;
  }

  async function captureStructureDraftFromEditor() {
    const ketcher = await getKetcherInstance();
    const smiles = String(await ketcher.getSmiles()).trim();
    const molfile = String(await ketcher.getMolfile('v3000')).trim();
    const imageDataUrl = await generateStructurePreview(ketcher, molfile || smiles);
    return toStructureDraft({ smiles, molfile, imageDataUrl });
  }

  async function openInventoryStructureEditor(button) {
    const mode = String(button.dataset.inventorySampleStructureOpen || '');
    const typeInput = getStructureTypeInput(mode);
    if (!isChemicalSampleType(typeInput?.value)) {
      syncStructureButtons();
      return;
    }

    const sampleId = String(button.dataset.sampleId || '');
    const sample = sampleId ? helpers.getSampleById(sampleId) : null;
    const pendingKey = getPendingStructureKey(mode);
    const draft = sample
      ? toStructureDraft(sample.compoundStructure)
      : toStructureDraft(pendingStructureDrafts.get(pendingKey));

    structureEditorContext = { mode, sampleId, pendingKey };
    openStructureDialog();
    const loaded = await syncStructureDraftToEditor(draft);
    if (!loaded) {
      setStructureStatus('Ketcher is still loading. Try Add Structure again in a moment.');
      return;
    }
    setStructureStatus('Ketcher is ready.');
  }

  function applyCapturedStructureDraft(draft) {
    const context = structureEditorContext;
    if (!context) {
      return;
    }
    const normalized = normalizeStructureData(draft);
    if (context.sampleId) {
      const sample = helpers.getSampleById(context.sampleId);
      if (sample) {
        sample.type = 'chemical';
        sample.compoundStructure = normalized;
        sample.updatedAt = new Date().toISOString();
        persist();
        notifySamplesChanged();
      }
      setStructureStatus(normalized ? 'Structure saved for this sample.' : 'No structure detected.');
      return;
    }

    if (normalized) {
      pendingStructureDrafts.set(context.pendingKey, normalized);
      setStructureStatus('Structure ready. Click Add Sample to save it.');
    } else {
      pendingStructureDrafts.delete(context.pendingKey);
      setStructureStatus('No structure detected.');
    }
  }

  async function onInventoryStructureApplyClick(event) {
    if (!structureEditorContext) {
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    try {
      const draft = await captureStructureDraftFromEditor();
      applyCapturedStructureDraft(draft);
    } catch {
      setStructureStatus('Cannot read Ketcher yet. Wait a second and try again.');
    } finally {
      closeStructureDialog();
      syncStructureButtons();
    }
  }

  function onInventoryStructureCloseClick(event) {
    if (!structureEditorContext) {
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    closeStructureDialog();
  }

  function onInventoryStructureOverlayClick(event) {
    if (!structureEditorContext || event.target !== sampleCompoundDialogOverlay) {
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    closeStructureDialog();
  }

  function onInventoryStructureKeydown(event) {
    if (event.key !== 'Escape' || !structureEditorContext) {
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    closeStructureDialog();
  }

  function delay(ms) {
    return new Promise((resolve) => {
      window.setTimeout(resolve, ms);
    });
  }

  async function generateStructurePreview(ketcher, structureSource) {
    if (!ketcher || !structureSource) {
      return '';
    }
    try {
      const pngBlob = await ketcher.generateImage(structureSource, {
        outputFormat: 'png',
        backgroundColor: '#ffffff',
        bondThickness: 1
      });
      return normalizeImagePayload(pngBlob, 'image/png');
    } catch {
      // Fall through to SVG generation.
    }
    try {
      const svgBlob = await ketcher.generateImage(structureSource, {
        outputFormat: 'svg',
        backgroundColor: '#ffffff',
        bondThickness: 1
      });
      return normalizeImagePayload(svgBlob, 'image/svg+xml');
    } catch {
      return '';
    }
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
    return '';
  }

  function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i += 1) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  function setAddContainerFormOpen(nextOpen) {
    uiState.isAddContainerFormOpen = Boolean(nextOpen);
    if (addContainerForm) {
      addContainerForm.hidden = !uiState.isAddContainerFormOpen;
    }
    if (uiState.isAddContainerFormOpen) {
      renderAddContainerTypeFields();
    }
  }

  function renderAddContainerTypeFields() {
    const showCustomGridFields = addContainerTypeSelect?.value === 'customGrid';
    if (addContainerGridFields) {
      addContainerGridFields.hidden = !showCustomGridFields;
    }
    [addContainerRowsInput, addContainerColsInput].forEach((input) => {
      if (!input) {
        return;
      }
      input.disabled = !showCustomGridFields;
      input.required = showCustomGridFields;
      if (showCustomGridFields && !String(input.value || '').trim()) {
        input.value = '9';
      }
    });
  }

  function resetAddContainerForm() {
    addContainerForm?.reset();
    if (addContainerLocationSelect) {
      addContainerLocationSelect.value = '';
    }
    if (addContainerTypeSelect) {
      addContainerTypeSelect.value = 'box81';
    }
    if (addContainerRowsInput) {
      addContainerRowsInput.value = '9';
    }
    if (addContainerColsInput) {
      addContainerColsInput.value = '9';
    }
    renderAddContainerTypeFields();
  }

  function renderAddContainerLocationOptions() {
    if (!addContainerLocationSelect) {
      return;
    }
    const selectedLocation = addContainerLocationSelect.value;
    const options = ['<option value="">Select location</option>'];
    helpers.getSectionNames().forEach((section) => {
      const isSelected = selectedLocation === section ? ' selected' : '';
      options.push(`<option value="${safeText(section)}"${isSelected}>${safeText(section)}</option>`);
    });
    addContainerLocationSelect.innerHTML = options.join('');
  }

  function openContainer(section, containerId) {
    const container = helpers.getContainer(section, containerId);
    if (!container) {
      return;
    }
    uiState.selectedSectionName = section;
    uiState.selectedContainer = { section, containerId };
    uiState.editingWellIndex = -1;
    uiState.editingSampleId = '';
    uiState.wellEditorStatus = '';
    uiState.shouldAutoOpenContainer = false;
    renderSections();
  }

  function renderSectionNavigation(activeSection) {
    if (!inventoryLocationNav) {
      return;
    }

    inventoryLocationNav.innerHTML = helpers.getSectionNames().map((section) => {
      const display = helpers.getSectionDisplay(section);
      const containerCount = helpers.getSectionContainerCount(section);
      const sampleCount = helpers.getSectionSampleCount(section);
      const containers = state.inventory?.[section] || [];
      const containerMarkup = section === activeSection
        ? `
          <div class="inventory-container-nav">
            ${containers.length ? containers.map((container) => {
              const isActive = uiState.selectedContainer && uiState.selectedContainer.section === section && uiState.selectedContainer.containerId === container.id;
              return `
                <div class="inventory-container-item">
                  <button type="button" class="inventory-container-btn${isActive ? ' active' : ''}" data-container-open="${safeText(container.id)}" data-section="${safeText(section)}">
                    <span class="inventory-container-name">${safeText(container.name)}</span>
                  </button>
                </div>
              `;
            }).join('') : '<p class="small-note inventory-container-nav-empty">No containers in this section yet.</p>'}
          </div>
        `
        : '';
      return `
        <div class="inventory-location-group">
          <button type="button" class="inventory-location-btn${section === activeSection ? ' active' : ''}" data-inventory-section="${safeText(section)}">
            <span class="inventory-location-icon">${safeText(display.short)}</span>
            <span class="inventory-location-copy">
              <span class="inventory-location-title">${safeText(display.title)}</span>
              <span class="inventory-location-meta">${safeText(`${containerCount} container${containerCount === 1 ? '' : 's'}`)}</span>
            </span>
            <span class="inventory-location-count">${safeText(String(sampleCount))}</span>
          </button>
          ${containerMarkup}
        </div>
      `;
    }).join('');

    inventoryLocationNav.querySelectorAll('[data-inventory-section]').forEach((button) => {
      button.addEventListener('click', () => {
        const section = button.dataset.inventorySection || helpers.getPreferredSection();
        uiState.selectedSectionName = section;
        uiState.editingWellIndex = -1;
        uiState.editingSampleId = '';
        uiState.wellEditorStatus = '';
        const firstContainer = (state.inventory?.[section] || [])[0];
        if (firstContainer) {
          openContainer(section, firstContainer.id);
          return;
        }
        uiState.selectedContainer = null;
        renderSections();
      });
    });

    inventoryLocationNav.querySelectorAll('[data-container-open]').forEach((button) => {
      button.addEventListener('click', () => {
        openContainer(button.dataset.section, button.dataset.containerOpen);
      });
    });
  }

  function renderSummaryCard(activeSection) {
    if (!inventorySummaryCard) {
      return;
    }
    const summary = helpers.getInventorySummaryCounts();
    const activeDisplay = helpers.getSectionDisplay(activeSection);
    inventorySummaryCard.innerHTML = `
      <div class="inventory-summary-head">
        <h3>Inventory Summary</h3>
        <p class="small-note">${safeText(activeDisplay.title)} has ${safeText(String(helpers.getSectionContainerCount(activeSection)))} container(s) and ${safeText(String(helpers.getSectionSampleCount(activeSection)))} linked sample(s).</p>
      </div>
      <div class="inventory-summary-stats">
        <div class="inventory-summary-row"><span class="inventory-summary-label"><span class="inventory-summary-dot inventory-summary-dot-total"></span>Total Samples</span><strong>${safeText(String(summary.total))}</strong></div>
        <div class="inventory-summary-row"><span class="inventory-summary-label"><span class="inventory-summary-dot inventory-summary-dot-plasmid"></span>Plasmids</span><strong>${safeText(String(summary.plasmid))}</strong></div>
        <div class="inventory-summary-row"><span class="inventory-summary-label"><span class="inventory-summary-dot inventory-summary-dot-cell"></span>Cells</span><strong>${safeText(String(summary.cell_line))}</strong></div>
        <div class="inventory-summary-row"><span class="inventory-summary-label"><span class="inventory-summary-dot inventory-summary-dot-protein"></span>Proteins</span><strong>${safeText(String(summary.protein))}</strong></div>
      </div>
    `;
  }

  function addContainerFromForm() {
    const section = addContainerLocationSelect?.value || '';
    const name = addContainerNameInput?.value.trim() || '';
    if (!section || !name) {
      return;
    }
    const type = ['single', 'plate96', 'customGrid'].includes(addContainerTypeSelect?.value) ? addContainerTypeSelect.value : 'box81';
    const customGrid = type === 'customGrid'
      ? normalizeCustomGridDimensions(addContainerRowsInput?.value, addContainerColsInput?.value)
      : null;
    const containerShape = type === 'customGrid'
      ? { type, gridRows: customGrid.rows, gridCols: customGrid.cols }
      : { type };
    const container = {
      id: createId(),
      name,
      ...containerShape,
      wells: createDefaultWells(containerShape),
      singleContent: type === 'single' ? '' : undefined
    };
    state.inventory[section] = state.inventory[section] || [];
    state.inventory[section].push(container);
    persist();
    uiState.selectedSectionName = section;
    uiState.selectedContainer = { section, containerId: container.id };
    uiState.editingWellIndex = -1;
    uiState.editingSampleId = '';
    uiState.wellEditorStatus = '';
    uiState.shouldAutoOpenContainer = true;
    resetAddContainerForm();
    setAddContainerFormOpen(false);
    notifyInventoryChanged();
    renderSections();
  }

  addContainerBtn?.addEventListener('click', () => {
    renderAddContainerLocationOptions();
    setAddContainerFormOpen(!uiState.isAddContainerFormOpen);
    if (uiState.isAddContainerFormOpen) {
      addContainerNameInput?.focus();
    }
  });
  addContainerTypeSelect?.addEventListener('change', renderAddContainerTypeFields);
  addContainerForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    addContainerFromForm();
  });
  addContainerCancelBtn?.addEventListener('click', () => {
    resetAddContainerForm();
    setAddContainerFormOpen(false);
  });
  sampleCompoundDialogApplyBtn?.addEventListener('click', onInventoryStructureApplyClick);
  sampleCompoundDialogCloseBtn?.addEventListener('click', onInventoryStructureCloseClick);
  sampleCompoundDialogCancelBtn?.addEventListener('click', onInventoryStructureCloseClick);
  sampleCompoundDialogOverlay?.addEventListener('click', onInventoryStructureOverlayClick);
  if (typeof document.addEventListener === 'function') {
    document.addEventListener('keydown', onInventoryStructureKeydown);
  }

  function renderSections() {
    renderAddContainerLocationOptions();
    renderAddContainerTypeFields();
    const activeSection = uiState.selectedContainer?.section || helpers.getPreferredSection();
    const activeContainers = state.inventory?.[activeSection] || [];
    if ((!uiState.selectedContainer || uiState.selectedContainer.section !== activeSection || !helpers.getContainer(activeSection, uiState.selectedContainer.containerId))
      && activeContainers.length
      && uiState.shouldAutoOpenContainer) {
      uiState.selectedContainer = { section: activeSection, containerId: activeContainers[0].id };
    }
    uiState.selectedSectionName = activeSection;
    renderSectionNavigation(activeSection);
    renderSummaryCard(activeSection);

    const activeContainer = uiState.selectedContainer?.section === activeSection
      ? helpers.getContainer(activeSection, uiState.selectedContainer.containerId)
      : null;
    const hiddenContainerOpeners = activeContainers.length
      ? `<div class="sr-only" aria-hidden="true">${activeContainers.map((container) => `<button type="button" data-container-open="${safeText(container.id)}" data-section="${safeText(activeSection)}">${safeText(container.name)}</button>`).join('')}</div>`
      : '';

    inventorySections.innerHTML = activeContainer
      ? `<section class="inventory-section inventory-section-active">${hiddenContainerOpeners}${renderContainerDetail(activeSection, activeContainer)}</section>`
      : `<section class="inventory-section inventory-section-active">${hiddenContainerOpeners}<p class="small-note inventory-empty-state">Select a container from the left panel to open its box view.</p></section>`;

    inventorySections.querySelectorAll('[data-container-open]').forEach((button) => {
      button.addEventListener('click', () => {
        openContainer(button.dataset.section, button.dataset.containerOpen);
      });
    });

    inventorySections.querySelectorAll('[data-container-delete]').forEach((button) => {
      button.addEventListener('click', () => {
        const section = button.dataset.section;
        const id = button.dataset.containerDelete;
        state.inventory[section] = (state.inventory[section] || []).filter((item) => item.id !== id);
        state.samples = (state.samples || []).map((sample) => {
          const link = sample.inventoryLink;
          if (!link || link.section !== section || link.containerId !== id) {
            return sample;
          }
          return { ...sample, inventoryLink: null, updatedAt: new Date().toISOString() };
        });

        if (uiState.selectedContainer && uiState.selectedContainer.section === section && uiState.selectedContainer.containerId === id) {
          uiState.selectedContainer = null;
          uiState.editingWellIndex = -1;
          uiState.editingSampleId = '';
          uiState.wellEditorStatus = '';
          uiState.shouldAutoOpenContainer = true;
        }

        uiState.selectedSectionName = section;
        persist();
        notifyInventoryChanged();
        renderSections();
      });
    });

    inventorySections.querySelectorAll('[data-well-index]').forEach((button) => {
      button.addEventListener('click', () => {
        const section = button.dataset.section;
        const containerId = button.dataset.containerId;
        if (!uiState.selectedContainer || uiState.selectedContainer.section !== section || uiState.selectedContainer.containerId !== containerId) {
          return;
        }
        uiState.editingWellIndex = Number(button.dataset.wellIndex);
        const linkedSamples = helpers.getLinkedSamples(section, containerId, uiState.editingWellIndex);
        uiState.editingSampleId = linkedSamples[0]?.id || '';
        uiState.wellEditorStatus = '';
        renderSections();
      });
    });

    inventorySections.querySelectorAll('[data-well-sample-select]').forEach((select) => {
      select.addEventListener('change', () => {
        uiState.editingSampleId = String(select.value || '');
        uiState.wellEditorStatus = '';
        renderSections();
      });
    });

    inventorySections.querySelectorAll('[data-well-sample-save]').forEach((button) => {
      button.addEventListener('click', () => {
        helpers.ensureSamples();
        const section = uiState.selectedContainer?.section;
        const containerId = uiState.selectedContainer?.containerId;
        const index = uiState.editingWellIndex;
        if (!section || !containerId || !Number.isInteger(index) || index < 0) {
          return;
        }
        const container = helpers.getContainer(section, containerId);
        const sample = helpers.getSampleById(button.dataset.wellSampleSave);
        if (!container || !sample) {
          return;
        }
        const codeInput = inventorySections.querySelector('[data-well-sample-code]');
        const nameInput = inventorySections.querySelector('[data-well-sample-name]');
        const typeInput = inventorySections.querySelector('[data-well-sample-type]');
        const lotInput = inventorySections.querySelector('[data-well-sample-lot]');
        const concentrationInput = inventorySections.querySelector('[data-well-sample-concentration]');
        const notesInput = inventorySections.querySelector('[data-well-sample-notes]');
        const name = String(nameInput?.value || '').trim();
        if (!name) {
          uiState.wellEditorStatus = 'Sample name is required.';
          renderSections();
          return;
        }
        const code = helpers.normalizeSampleCode(codeInput?.value) || sample.code || helpers.makeDefaultSampleCode();
        const duplicate = (state.samples || []).find((item) => item.code === code && item.id !== sample.id);
        if (duplicate) {
          uiState.wellEditorStatus = `Sample code ${code} already exists.`;
          renderSections();
          return;
        }
        sample.code = code;
        sample.name = name;
        sample.type = helpers.normalizeSampleType(typeInput?.value || sample.type || 'plasmid');
        if (!isChemicalSampleType(sample.type)) {
          sample.compoundStructure = null;
        }
        sample.lot = String(lotInput?.value || '').trim();
        sample.concentration = String(concentrationInput?.value || '').trim();
        sample.notes = String(notesInput?.value || '').trim();
        sample.inventoryLink = { section, containerId, wellIndex: index };
        sample.location = helpers.isLocationEmpty(sample.location) ? helpers.buildAutoLocationFromLink(section, container, index) : sample.location;
        sample.updatedAt = new Date().toISOString();
        uiState.editingSampleId = sample.id;
        uiState.wellEditorStatus = `Saved sample ${sample.code || sample.name}.`;
        persist();
        notifySamplesChanged();
        renderSections();
      });
    });

    inventorySections.querySelectorAll('[data-well-sample-unlink]').forEach((button) => {
      button.addEventListener('click', () => {
        helpers.ensureSamples();
        const sample = helpers.getSampleById(button.dataset.wellSampleUnlink);
        if (!sample) {
          return;
        }
        sample.inventoryLink = null;
        sample.updatedAt = new Date().toISOString();
        uiState.editingSampleId = '';
        uiState.wellEditorStatus = `Unlinked sample ${sample.code || sample.name || sample.id}.`;
        persist();
        notifySamplesChanged();
        renderSections();
      });
    });

    inventorySections.querySelectorAll('[data-well-sample-create]').forEach((button) => {
      button.addEventListener('click', () => {
        helpers.ensureSamples();
        const section = uiState.selectedContainer?.section;
        const containerId = uiState.selectedContainer?.containerId;
        const index = Number(button.dataset.wellSampleCreate);
        if (!section || !containerId || !Number.isInteger(index) || index < 0) {
          return;
        }
        const container = helpers.getContainer(section, containerId);
        if (!container) {
          return;
        }
        const codeInput = inventorySections.querySelector('[data-well-sample-new-code]');
        const nameInput = inventorySections.querySelector('[data-well-sample-new-name]');
        const typeInput = inventorySections.querySelector('[data-well-sample-new-type]');
        const lotInput = inventorySections.querySelector('[data-well-sample-new-lot]');
        const concentrationInput = inventorySections.querySelector('[data-well-sample-new-concentration]');
        const notesInput = inventorySections.querySelector('[data-well-sample-new-notes]');
        const name = String(nameInput?.value || '').trim();
        if (!name) {
          uiState.wellEditorStatus = 'Sample name is required.';
          renderSections();
          return;
        }
        const code = helpers.normalizeSampleCode(codeInput?.value) || helpers.makeDefaultSampleCode();
        const duplicate = (state.samples || []).find((item) => item.code === code);
        if (duplicate) {
          uiState.wellEditorStatus = `Sample code ${code} already exists.`;
          renderSections();
          return;
        }
        const sample = {
          id: `sample-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
          code,
          name,
          type: helpers.normalizeSampleType(typeInput?.value || 'plasmid'),
          lot: String(lotInput?.value || '').trim(),
          concentration: String(concentrationInput?.value || '').trim(),
          notes: String(notesInput?.value || '').trim(),
          location: helpers.buildAutoLocationFromLink(section, container, index),
          inventoryLink: { section, containerId, wellIndex: index },
          chemicalLinks: [],
          compoundStructure: isChemicalSampleType(typeInput?.value)
            ? normalizeStructureData(pendingStructureDrafts.get(getPendingStructureKey('well-new')))
            : null,
          updatedAt: new Date().toISOString()
        };
        pendingStructureDrafts.delete(getPendingStructureKey('well-new'));
        state.samples.push(sample);
        uiState.editingSampleId = sample.id;
        uiState.wellEditorStatus = `Created sample ${sample.code}.`;
        persist();
        notifySamplesChanged();
        renderSections();
      });
    });

    inventorySections.querySelectorAll('[data-single-sample-select]').forEach((select) => {
      select.addEventListener('change', () => {
        uiState.editingSampleId = String(select.value || '');
        uiState.wellEditorStatus = '';
        renderSections();
      });
    });

    inventorySections.querySelectorAll('[data-single-sample-save]').forEach((button) => {
      button.addEventListener('click', () => {
        helpers.ensureSamples();
        const section = uiState.selectedContainer?.section;
        const containerId = uiState.selectedContainer?.containerId;
        if (!section || !containerId) {
          return;
        }
        const container = helpers.getContainer(section, containerId);
        const sample = helpers.getSampleById(button.dataset.singleSampleSave);
        if (!container || !sample) {
          return;
        }
        const codeInput = inventorySections.querySelector('[data-single-sample-code]');
        const nameInput = inventorySections.querySelector('[data-single-sample-name]');
        const typeInput = inventorySections.querySelector('[data-single-sample-type]');
        const lotInput = inventorySections.querySelector('[data-single-sample-lot]');
        const concentrationInput = inventorySections.querySelector('[data-single-sample-concentration]');
        const notesInput = inventorySections.querySelector('[data-single-sample-notes]');
        const name = String(nameInput?.value || '').trim();
        if (!name) {
          uiState.wellEditorStatus = 'Sample name is required.';
          renderSections();
          return;
        }
        const code = helpers.normalizeSampleCode(codeInput?.value) || sample.code || helpers.makeDefaultSampleCode();
        const duplicate = (state.samples || []).find((item) => item.code === code && item.id !== sample.id);
        if (duplicate) {
          uiState.wellEditorStatus = `Sample code ${code} already exists.`;
          renderSections();
          return;
        }
        sample.code = code;
        sample.name = name;
        sample.type = helpers.normalizeSampleType(typeInput?.value || sample.type || 'plasmid');
        if (!isChemicalSampleType(sample.type)) {
          sample.compoundStructure = null;
        }
        sample.lot = String(lotInput?.value || '').trim();
        sample.concentration = String(concentrationInput?.value || '').trim();
        sample.notes = String(notesInput?.value || '').trim();
        sample.inventoryLink = { section, containerId, wellIndex: null };
        sample.location = helpers.isLocationEmpty(sample.location) ? helpers.buildAutoLocationFromLink(section, container, null) : sample.location;
        sample.updatedAt = new Date().toISOString();
        uiState.editingSampleId = sample.id;
        uiState.wellEditorStatus = `Saved sample ${sample.code || sample.name}.`;
        persist();
        notifySamplesChanged();
        renderSections();
      });
    });

    inventorySections.querySelectorAll('[data-single-sample-unlink]').forEach((button) => {
      button.addEventListener('click', () => {
        helpers.ensureSamples();
        const sample = helpers.getSampleById(button.dataset.singleSampleUnlink);
        if (!sample) {
          return;
        }
        sample.inventoryLink = null;
        sample.updatedAt = new Date().toISOString();
        uiState.editingSampleId = '';
        uiState.wellEditorStatus = `Unlinked sample ${sample.code || sample.name || sample.id}.`;
        persist();
        notifySamplesChanged();
        renderSections();
      });
    });

    inventorySections.querySelectorAll('[data-single-sample-create]').forEach((button) => {
      button.addEventListener('click', () => {
        helpers.ensureSamples();
        const section = uiState.selectedContainer?.section;
        const containerId = uiState.selectedContainer?.containerId;
        if (!section || !containerId) {
          return;
        }
        const container = helpers.getContainer(section, containerId);
        if (!container) {
          return;
        }
        const codeInput = inventorySections.querySelector('[data-single-sample-new-code]');
        const nameInput = inventorySections.querySelector('[data-single-sample-new-name]');
        const typeInput = inventorySections.querySelector('[data-single-sample-new-type]');
        const lotInput = inventorySections.querySelector('[data-single-sample-new-lot]');
        const concentrationInput = inventorySections.querySelector('[data-single-sample-new-concentration]');
        const notesInput = inventorySections.querySelector('[data-single-sample-new-notes]');
        const name = String(nameInput?.value || '').trim();
        if (!name) {
          uiState.wellEditorStatus = 'Sample name is required.';
          renderSections();
          return;
        }
        const code = helpers.normalizeSampleCode(codeInput?.value) || helpers.makeDefaultSampleCode();
        const duplicate = (state.samples || []).find((item) => item.code === code);
        if (duplicate) {
          uiState.wellEditorStatus = `Sample code ${code} already exists.`;
          renderSections();
          return;
        }
        const sample = {
          id: `sample-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
          code,
          name,
          type: helpers.normalizeSampleType(typeInput?.value || 'plasmid'),
          lot: String(lotInput?.value || '').trim(),
          concentration: String(concentrationInput?.value || '').trim(),
          notes: String(notesInput?.value || '').trim(),
          location: helpers.buildAutoLocationFromLink(section, container, null),
          inventoryLink: { section, containerId, wellIndex: null },
          chemicalLinks: [],
          compoundStructure: isChemicalSampleType(typeInput?.value)
            ? normalizeStructureData(pendingStructureDrafts.get(getPendingStructureKey('single-new')))
            : null,
          updatedAt: new Date().toISOString()
        };
        pendingStructureDrafts.delete(getPendingStructureKey('single-new'));
        state.samples.push(sample);
        uiState.editingSampleId = sample.id;
        uiState.wellEditorStatus = `Created sample ${sample.code}.`;
        persist();
        notifySamplesChanged();
        renderSections();
      });
    });

    [
      '[data-well-sample-type]',
      '[data-well-sample-new-type]',
      '[data-single-sample-type]',
      '[data-single-sample-new-type]'
    ].forEach((selector) => {
      inventorySections.querySelectorAll(selector).forEach((select) => {
        select.addEventListener('change', syncStructureButtons);
      });
    });

    inventorySections.querySelectorAll('[data-inventory-sample-structure-open]').forEach((button) => {
      button.addEventListener('click', () => {
        openInventoryStructureEditor(button).catch(() => {
          setStructureStatus('Cannot open Ketcher yet. Wait a second and try again.');
        });
      });
    });

    syncStructureButtons();
  }

  return { renderSections };
}
