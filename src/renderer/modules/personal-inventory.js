export function initPersonalInventory({
  state,
  persist,
  createId,
  safeText,
  cssEscape,
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
  const addContainerCancelBtn = document.getElementById('inventory-add-container-cancel');

  let selectedContainer = null;
  let selectedSectionName = '';
  let editingWellIndex = null;
  let editingSampleId = '';
  let wellEditorStatus = '';
  let isAddContainerFormOpen = false;
  let shouldAutoOpenContainer = true;
  const SAMPLE_TYPE_COLORS = {
    plasmid: '#2f6fec',
    cell_line: '#e8871a',
    strain: '#159a8a',
    antibody: '#d75062',
    protein: '#3b9d3a',
    compound: '#7a58e8',
    primer: '#be9a1a',
    other: '#718096'
  };
  const SAMPLE_TYPE_LABELS = {
    plasmid: 'Plasmid',
    cell_line: 'Cell Line',
    strain: 'Strain',
    antibody: 'Antibody',
    protein: 'Protein',
    compound: 'Compound',
    primer: 'Primer',
    other: 'Other'
  };
  const SECTION_DISPLAY = {
    'Room Temp': { short: 'RT', title: 'Room Temp', note: 'Bench and cabinet storage' },
    '4 Degree': { short: '4C', title: '4 C', note: 'Cold shelf storage' },
    '-20 Degree': { short: '-20', title: '-20 C', note: 'Short-term freezer storage' },
    '-80 Degree': { short: '-80', title: '-80 C', note: 'Long-term freezer storage' },
    'Liquid Nitrogen': { short: 'LN2', title: 'Liquid Nitrogen', note: 'Cryogenic storage' }
  };
  function getContainerTypeLabel(type) {
    if (type === 'single') {
      return 'Single container';
    }
    if (type === 'plate96') {
      return '96-well plate';
    }
    return '81-well cube box';
  }

  function getContainerLayout(type) {
    if (type === 'plate96') {
      return {
        rows: 8,
        cols: 12,
        className: 'plate96',
        helperText: '96-well microplate with SBS footprint. Click a well to assign or edit linked samples.'
      };
    }
    return {
      rows: 9,
      cols: 9,
      className: 'box81',
      helperText: '9 x 9 square box (81 wells). Click a cell to set samples on the right side.'
    };
  }

  function createDefaultWells(type) {
    if (type === 'single') {
      return [];
    }
    const layout = getContainerLayout(type);
    return Array.from({ length: layout.rows * layout.cols }, (_item, index) => ({
      name: getWellName(type, index),
      content: ''
    }));
  }

  function getWellName(type, index) {
    if (type === 'plate96') {
      const rowLabel = String.fromCharCode(65 + Math.floor(index / 12));
      const columnLabel = (index % 12) + 1;
      return `${rowLabel}${columnLabel}`;
    }
    return `W${index + 1}`;
  }

  function getSectionNames() {
    return ['Room Temp', '4 Degree', '-20 Degree', '-80 Degree', 'Liquid Nitrogen'];
  }

  function getSectionDisplay(section) {
    return SECTION_DISPLAY[section] || { short: '--', title: section || 'Unknown', note: '' };
  }

  function getContainer(section, containerId) {
    return (state.inventory[section] || []).find((item) => item.id === containerId);
  }

  function getLinkedSamples(section, containerId, wellIndex = null) {
    return (state.samples || []).filter((sample) => {
      const link = sample.inventoryLink;
      if (!link) {
        return false;
      }
      if (link.section !== section || link.containerId !== containerId) {
        return false;
      }
      if (wellIndex === null) {
        return link.wellIndex === null || link.wellIndex === undefined;
      }
      return Number(link.wellIndex) === Number(wellIndex);
    });
  }

  function getContainerSampleCount(section, containerId) {
    const container = getContainer(section, containerId);
    if (!container) {
      return 0;
    }
    const directCount = getLinkedSamples(section, containerId, null).length;
    if (container.type === 'single') {
      return directCount;
    }
    return directCount + (container.wells || []).reduce((count, _well, index) => {
      return count + getLinkedSamples(section, containerId, index).length;
    }, 0);
  }

  function getSectionContainerCount(section) {
    return Array.isArray(state.inventory?.[section]) ? state.inventory[section].length : 0;
  }

  function getSectionSampleCount(section) {
    return (state.inventory?.[section] || []).reduce((count, container) => {
      return count + getContainerSampleCount(section, container.id);
    }, 0);
  }

  function getPreferredSection() {
    const sections = getSectionNames();
    if (selectedContainer?.section && sections.includes(selectedContainer.section)) {
      return selectedContainer.section;
    }
    if (selectedSectionName && sections.includes(selectedSectionName)) {
      return selectedSectionName;
    }
    const firstWithContainers = sections.find((section) => getSectionContainerCount(section) > 0);
    return firstWithContainers || sections[0];
  }

  function ensureSamples() {
    if (!Array.isArray(state.samples)) {
      state.samples = [];
    }
  }

  function makeDefaultSampleCode() {
    return `S-${Date.now().toString().slice(-6)}`;
  }

  function normalizeSampleCode(value) {
    return String(value || '')
      .trim()
      .replace(/\s+/g, '-')
      .replace(/[^a-zA-Z0-9._-]/g, '');
  }

  function getSampleById(sampleId) {
    return (state.samples || []).find((sample) => sample.id === sampleId) || null;
  }

  function isLocationEmpty(location) {
    if (!location || typeof location !== 'object') {
      return true;
    }
    return Object.entries(location)
      .filter(([key]) => key !== 'storageType')
      .every(([, value]) => !String(value || '').trim());
  }

  function buildAutoLocationFromLink(section, container, index) {
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
      position: String(Number(index) + 1)
    };
  }

  function normalizeSampleType(type) {
    const key = String(type || '').trim().toLowerCase();
    if (!key) {
      return 'other';
    }
    return Object.prototype.hasOwnProperty.call(SAMPLE_TYPE_COLORS, key) ? key : 'other';
  }

  function getSampleTypeColor(type) {
    return SAMPLE_TYPE_COLORS[normalizeSampleType(type)] || SAMPLE_TYPE_COLORS.other;
  }

  function getSampleTypeLabel(type) {
    return SAMPLE_TYPE_LABELS[normalizeSampleType(type)] || SAMPLE_TYPE_LABELS.other;
  }

  function renderSampleTypeOptions(selectedType = 'plasmid') {
    const selected = normalizeSampleType(selectedType);
    return Object.entries(SAMPLE_TYPE_LABELS)
      .filter(([value]) => value !== 'other')
      .map(([value, label]) => `<option value="${safeText(value)}"${selected === value ? ' selected' : ''}>${safeText(label)}</option>`)
      .join('');
  }

  function getInventorySummaryCounts() {
    const counts = {
      total: Array.isArray(state.samples) ? state.samples.length : 0,
      plasmid: 0,
      cell_line: 0,
      protein: 0
    };

    (state.samples || []).forEach((sample) => {
      const type = normalizeSampleType(sample?.type);
      if (Object.prototype.hasOwnProperty.call(counts, type)) {
        counts[type] += 1;
      }
    });

    return counts;
  }

  function buildSampleDotFill(sampleTypes) {
    const unique = Array.from(new Set((sampleTypes || []).map((type) => normalizeSampleType(type))));
    if (!unique.length) {
      return '';
    }
    if (unique.length === 1) {
      return getSampleTypeColor(unique[0]);
    }
    const segmentSize = 100 / unique.length;
    const segments = unique.map((type, index) => {
      const start = Number((segmentSize * index).toFixed(2));
      const end = Number((segmentSize * (index + 1)).toFixed(2));
      return `${getSampleTypeColor(type)} ${start}% ${end}%`;
    });
    return `conic-gradient(${segments.join(', ')})`;
  }

  function renderSampleLegendForContainer(section, container) {
    const linkedTypeSet = new Set();
    (state.samples || []).forEach((sample) => {
      const link = sample?.inventoryLink;
      if (!link) {
        return;
      }
      if (link.section !== section || link.containerId !== container.id) {
        return;
      }
      linkedTypeSet.add(normalizeSampleType(sample.type));
    });
    const linkedTypes = Array.from(linkedTypeSet);
    if (!linkedTypes.length) {
      return '';
    }

    return `
      <div class="well-sample-legend" aria-label="Sample type color legend">
        ${linkedTypes.map((type) => `
          <span class="well-sample-legend-item">
            <span class="well-sample-legend-dot" style="--sample-type-color:${getSampleTypeColor(type)};"></span>
            ${safeText(getSampleTypeLabel(type))}
          </span>
        `).join('')}
      </div>
    `;
  }

  function getWellData(rawWell, index) {
    const fallbackName = getWellName(selectedContainer?.section ? getContainer(selectedContainer.section, selectedContainer.containerId)?.type : 'box81', index);
    if (rawWell && typeof rawWell === 'object') {
      return {
        name: String(rawWell.name || '').trim() || fallbackName,
        content: String(rawWell.content || '').trim()
      };
    }

    return {
      name: fallbackName,
      content: String(rawWell || '').trim()
    };
  }

  function getWellDataForType(type, rawWell, index) {
    const fallbackName = getWellName(type, index);
    if (rawWell && typeof rawWell === 'object') {
      return {
        name: String(rawWell.name || '').trim() || fallbackName,
        content: String(rawWell.content || '').trim()
      };
    }

    return {
      name: fallbackName,
      content: String(rawWell || '').trim()
    };
  }

  function renderWellEditor(section, container, index) {
    if (!Number.isInteger(index) || index < 0) {
      return `
        <div class="well-inline-editor well-side-editor">
          <p class="small-note well-editor-empty">Select one cell to edit well and sample information.</p>
        </div>
      `;
    }

    const well = getWellDataForType(container.type || 'box81', container.wells[index], index);
    const linkedSamples = getLinkedSamples(section, container.id, index);
    const activeSample = linkedSamples.find((item) => item.id === editingSampleId) || linkedSamples[0] || null;
    const statusMarkup = wellEditorStatus ? `<p class="small-note well-editor-status">${safeText(wellEditorStatus)}</p>` : '';
    const sampleSelector = linkedSamples.length > 1
      ? `
        <label>
          Linked Sample
          <select data-well-sample-select="${index}">
            ${linkedSamples.map((item) => `
              <option value="${safeText(item.id)}"${activeSample && item.id === activeSample.id ? ' selected' : ''}>
                ${safeText(item.code || item.name || item.id)}
              </option>
            `).join('')}
          </select>
        </label>
      `
      : '';
    const sampleSection = activeSample
      ? `
        ${sampleSelector}
        <label>
          Sample Code
          <input data-well-sample-code value="${safeText(activeSample.code || '')}" placeholder="e.g. S-001" />
        </label>
        <label>
          Sample Name
          <input data-well-sample-name value="${safeText(activeSample.name || '')}" required />
        </label>
        <label>
          Type
          <select data-well-sample-type>
            ${renderSampleTypeOptions(activeSample.type || 'plasmid')}
          </select>
        </label>
        <label>
          Lot / Batch
          <input data-well-sample-lot value="${safeText(activeSample.lot || '')}" />
        </label>
        <label>
          Concentration
          <input data-well-sample-concentration value="${safeText(activeSample.concentration || '')}" placeholder="e.g. 2 mg/mL" />
        </label>
        <label>
          Notes
          <textarea data-well-sample-notes rows="3">${safeText(activeSample.notes || '')}</textarea>
        </label>
        <div class="inline-row">
          <button type="button" class="primary-btn" data-well-sample-save="${safeText(activeSample.id)}">Save Sample</button>
          <button type="button" class="ghost-btn" data-well-sample-unlink="${safeText(activeSample.id)}">Unlink Sample</button>
        </div>
      `
      : `
        <p class="small-note">No sample linked to this cell yet.</p>
        <label>
          Sample Code
          <input data-well-sample-new-code placeholder="e.g. S-001" />
        </label>
        <label>
          Sample Name
          <input data-well-sample-new-name placeholder="Required" />
        </label>
        <label>
          Type
          <select data-well-sample-new-type>
            ${renderSampleTypeOptions('plasmid')}
          </select>
        </label>
        <label>
          Lot / Batch
          <input data-well-sample-new-lot />
        </label>
        <label>
          Concentration
          <input data-well-sample-new-concentration placeholder="e.g. 2 mg/mL" />
        </label>
        <label>
          Notes
          <textarea data-well-sample-new-notes rows="3"></textarea>
        </label>
        <div class="inline-row">
          <button type="button" class="primary-btn" data-well-sample-create="${index}">Create Linked Sample</button>
        </div>
      `;

    return `
      <div class="well-inline-editor well-side-editor">
        <strong>${safeText(well.name)} (Cell ${index + 1})</strong>
        <strong>Set Samples</strong>
        ${sampleSection}
        <div class="inline-row">
          <button type="button" class="ghost-btn" data-well-cancel>Clear Selection</button>
        </div>
        ${statusMarkup}
      </div>
    `;
  }

  function renderContainerDetail(section, container) {
    if (!container) {
      return '';
    }

    if (container.type === 'single') {
      const linkedSamples = getLinkedSamples(section, container.id, null);
      return `
        <div class="container-inline-detail">
          <h4>${safeText(section)} / ${safeText(container.name)} (${getContainerTypeLabel(container.type)})</h4>
          <p class="small-note">Single container (tube or bottle).</p>
          <p class="small-note">Linked samples: ${safeText(linkedSamples.map((item) => item.code || item.name || item.id).join(', ') || '-')}</p>
          <div class="stack-form">
            <label>
              Container Content
              <textarea data-single-container-content="${safeText(container.id)}" rows="4" placeholder="Describe content in tube or bottle">${safeText(container.singleContent || '')}</textarea>
            </label>
            <button type="button" class="primary-btn" data-single-container-save="${safeText(container.id)}">Save Content</button>
          </div>
          <div class="container-detail-actions">
            <button
              type="button"
              class="danger-btn"
              data-container-delete="${safeText(container.id)}"
              data-section="${safeText(section)}"
            >Delete</button>
          </div>
        </div>
      `;
    }

    const layout = getContainerLayout(container.type || 'box81');
    const wells = Array.isArray(container.wells) ? container.wells : [];
    const grid = wells.map((rawWell, index) => {
      const well = getWellDataForType(container.type || 'box81', rawWell, index);
      const linkedSamples = getLinkedSamples(section, container.id, index);
      const linkedTypeLabels = Array.from(new Set(linkedSamples.map((item) => getSampleTypeLabel(item.type))));
      const linkedText = linkedSamples.length
        ? ` | Samples: ${linkedSamples.map((item) => item.code || item.name || item.id).join(', ')}${linkedTypeLabels.length ? ` | Types: ${linkedTypeLabels.join(', ')}` : ''}`
        : '';
      const title = well.content ? `${well.name}: ${well.content}${linkedText}` : `${well.name}${linkedText}`;
      const sampleDotFill = buildSampleDotFill(linkedSamples.map((item) => item.type));
      const hasSamples = linkedSamples.length > 0;
      const sampleCount = linkedSamples.length;
      return `
        <button
          type="button"
          class="well well-${safeText(layout.className)}${editingWellIndex === index ? ' well-selected' : ''}"
          data-well-index="${index}"
          data-section="${safeText(section)}"
          data-container-id="${safeText(container.id)}"
          title="${safeText(title)}"
        >
          <span class="well-number">${safeText(well.name)}</span>
          <span class="well-sample-dot${hasSamples ? ' has-sample' : ''}"${sampleDotFill ? ` style="--well-sample-fill:${sampleDotFill};"` : ''}></span>
          ${sampleCount > 1 ? `<span class="well-sample-count">${safeText(String(sampleCount))}</span>` : ''}
        </button>
      `;
    }).join('');

    return `
      <div class="container-inline-detail">
        <h4>${safeText(section)} / ${safeText(container.name)} (${getContainerTypeLabel(container.type)})</h4>
        <p class="small-note">${safeText(layout.helperText)}</p>
        <div class="well-editor-shell">
          <div class="well-grid-panel well-grid-panel-${safeText(layout.className)}">
            <div
              class="well-grid well-grid-${safeText(layout.className)}"
              style="--well-grid-cols:${safeText(String(layout.cols))}; --well-grid-rows:${safeText(String(layout.rows))};"
            >${grid}</div>
            ${renderSampleLegendForContainer(section, container)}
          </div>
          ${renderWellEditor(section, container, editingWellIndex)}
        </div>
        <div class="container-detail-actions">
          <button
            type="button"
            class="danger-btn"
            data-container-delete="${safeText(container.id)}"
            data-section="${safeText(section)}"
          >Delete</button>
        </div>
      </div>
    `;
  }

  function renderSectionNavigation(activeSection) {
    if (!inventoryLocationNav) {
      return;
    }

    inventoryLocationNav.innerHTML = getSectionNames().map((section) => {
      const display = getSectionDisplay(section);
      const containerCount = getSectionContainerCount(section);
      const sampleCount = getSectionSampleCount(section);
      const containerLabel = `${containerCount} container${containerCount === 1 ? '' : 's'}`;
      const containers = state.inventory?.[section] || [];
      const containerMarkup = section === activeSection
        ? `
          <div class="inventory-container-nav">
            ${containers.length ? containers.map((container) => {
      const isActive = selectedContainer && selectedContainer.section === section && selectedContainer.containerId === container.id;
      return `
                <div class="inventory-container-item">
                  <button
                    type="button"
                    class="inventory-container-btn${isActive ? ' active' : ''}"
                    data-container-open="${safeText(container.id)}"
                    data-section="${safeText(section)}"
                  >
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
          <button
            type="button"
            class="inventory-location-btn${section === activeSection ? ' active' : ''}"
            data-inventory-section="${safeText(section)}"
          >
            <span class="inventory-location-icon">${safeText(display.short)}</span>
            <span class="inventory-location-copy">
              <span class="inventory-location-title">${safeText(display.title)}</span>
              <span class="inventory-location-meta">${safeText(containerLabel)}</span>
            </span>
            <span class="inventory-location-count">${safeText(String(sampleCount))}</span>
          </button>
          ${containerMarkup}
        </div>
      `;
    }).join('');

    inventoryLocationNav.querySelectorAll('[data-inventory-section]').forEach((button) => {
      button.addEventListener('click', () => {
        const section = button.dataset.inventorySection || getPreferredSection();
        selectedSectionName = section;
        editingWellIndex = -1;
        editingSampleId = '';
        wellEditorStatus = '';
        const firstContainer = (state.inventory?.[section] || [])[0];
        if (firstContainer) {
          openContainer(section, firstContainer.id);
          return;
        }
        selectedContainer = null;
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

    const summary = getInventorySummaryCounts();
    const activeDisplay = getSectionDisplay(activeSection);

    inventorySummaryCard.innerHTML = `
      <div class="inventory-summary-head">
        <h3>Inventory Summary</h3>
        <p class="small-note">${safeText(activeDisplay.title)} has ${safeText(String(getSectionContainerCount(activeSection)))} container(s) and ${safeText(String(getSectionSampleCount(activeSection)))} linked sample(s).</p>
      </div>
      <div class="inventory-summary-stats">
        <div class="inventory-summary-row">
          <span class="inventory-summary-label"><span class="inventory-summary-dot inventory-summary-dot-total"></span>Total Samples</span>
          <strong>${safeText(String(summary.total))}</strong>
        </div>
        <div class="inventory-summary-row">
          <span class="inventory-summary-label"><span class="inventory-summary-dot inventory-summary-dot-plasmid"></span>Plasmids</span>
          <strong>${safeText(String(summary.plasmid))}</strong>
        </div>
        <div class="inventory-summary-row">
          <span class="inventory-summary-label"><span class="inventory-summary-dot inventory-summary-dot-cell"></span>Cells</span>
          <strong>${safeText(String(summary.cell_line))}</strong>
        </div>
        <div class="inventory-summary-row">
          <span class="inventory-summary-label"><span class="inventory-summary-dot inventory-summary-dot-protein"></span>Proteins</span>
          <strong>${safeText(String(summary.protein))}</strong>
        </div>
      </div>
    `;
  }

  function openContainer(section, containerId) {
    const container = getContainer(section, containerId);
    if (!container) {
      return;
    }

    selectedSectionName = section;
    selectedContainer = { section, containerId };
    editingWellIndex = -1;
    editingSampleId = '';
    wellEditorStatus = '';
    shouldAutoOpenContainer = false;
    renderSections();
  }

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

  function setAddContainerFormOpen(nextOpen) {
    isAddContainerFormOpen = Boolean(nextOpen);
    if (addContainerForm) {
      addContainerForm.hidden = !isAddContainerFormOpen;
    }
  }

  function renderAddContainerLocationOptions() {
    if (!addContainerLocationSelect) {
      return;
    }

    const selectedLocation = addContainerLocationSelect.value;
    const options = ['<option value="">Select location</option>'];
    getSectionNames().forEach((section) => {
      const isSelected = selectedLocation === section ? ' selected' : '';
      options.push(`<option value="${safeText(section)}"${isSelected}>${safeText(section)}</option>`);
    });
    addContainerLocationSelect.innerHTML = options.join('');
  }

  function addContainerFromForm() {
    const section = addContainerLocationSelect?.value || '';
    const name = addContainerNameInput?.value.trim() || '';
    if (!section || !name) {
      return;
    }

    const type = ['single', 'plate96'].includes(addContainerTypeSelect?.value) ? addContainerTypeSelect.value : 'box81';
    const container = {
      id: createId(),
      name,
      type,
      wells: createDefaultWells(type),
      singleContent: type === 'single' ? '' : undefined
    };

    state.inventory[section] = state.inventory[section] || [];
    state.inventory[section].push(container);
    persist();

    selectedSectionName = section;
    selectedContainer = { section, containerId: container.id };
    editingWellIndex = -1;
    editingSampleId = '';
    wellEditorStatus = '';
    shouldAutoOpenContainer = true;
    if (addContainerNameInput) {
      addContainerNameInput.value = '';
    }
    setAddContainerFormOpen(false);
    notifyInventoryChanged();
    renderSections();
  }

  addContainerBtn?.addEventListener('click', () => {
    renderAddContainerLocationOptions();
    setAddContainerFormOpen(!isAddContainerFormOpen);
    if (isAddContainerFormOpen) {
      addContainerNameInput?.focus();
    }
  });

  addContainerForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    addContainerFromForm();
  });

  addContainerCancelBtn?.addEventListener('click', () => {
    setAddContainerFormOpen(false);
  });

  function renderSections() {
    renderAddContainerLocationOptions();
    const activeSection = selectedContainer?.section || getPreferredSection();
    const activeContainers = state.inventory?.[activeSection] || [];
    if (
      (!selectedContainer || selectedContainer.section !== activeSection || !getContainer(activeSection, selectedContainer.containerId))
      && activeContainers.length
      && shouldAutoOpenContainer
    ) {
      selectedContainer = { section: activeSection, containerId: activeContainers[0].id };
    }
    selectedSectionName = activeSection;
    renderSectionNavigation(activeSection);
    renderSummaryCard(activeSection);

    const activeContainer = selectedContainer?.section === activeSection
      ? getContainer(activeSection, selectedContainer.containerId)
      : null;
    const hiddenContainerOpeners = activeContainers.length
      ? `
        <div class="sr-only" aria-hidden="true">
          ${activeContainers.map((container) => `
            <button
              type="button"
              data-container-open="${safeText(container.id)}"
              data-section="${safeText(activeSection)}"
            >${safeText(container.name)}</button>
          `).join('')}
        </div>
      `
      : '';

    inventorySections.innerHTML = activeContainer
      ? `
        <section class="inventory-section inventory-section-active">
          ${hiddenContainerOpeners}
          ${renderContainerDetail(activeSection, activeContainer)}
        </section>
      `
      : `
        <section class="inventory-section inventory-section-active">
          ${hiddenContainerOpeners}
          <p class="small-note inventory-empty-state">Select a container from the left panel to open its box view.</p>
        </section>
      `;

    inventorySections.querySelectorAll('[data-container-open]').forEach((button) => {
      button.addEventListener('click', () => {
        const section = button.dataset.section;
        const containerId = button.dataset.containerOpen;
        openContainer(section, containerId);
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
          return {
            ...sample,
            inventoryLink: null,
            updatedAt: new Date().toISOString()
          };
        });

        if (selectedContainer && selectedContainer.section === section && selectedContainer.containerId === id) {
          selectedContainer = null;
          editingWellIndex = -1;
          editingSampleId = '';
          wellEditorStatus = '';
          shouldAutoOpenContainer = true;
        }

        selectedSectionName = section;
        persist();
        notifyInventoryChanged();
        renderSections();
      });
    });

    inventorySections.querySelectorAll('[data-single-container-save]').forEach((button) => {
      button.addEventListener('click', () => {
        const containerId = button.dataset.singleContainerSave;
        const section = selectedContainer?.section || activeSection;
        if (!section) {
          return;
        }

        const container = getContainer(section, containerId);
        if (!container) {
          return;
        }

        const contentInput = inventorySections.querySelector(
          `[data-single-container-content="${cssEscape(containerId)}"]`
        );
        container.singleContent = contentInput?.value.trim() || '';
        persist();
      });
    });

    inventorySections.querySelectorAll('[data-well-index]').forEach((button) => {
      button.addEventListener('click', () => {
        const section = button.dataset.section;
        const containerId = button.dataset.containerId;
        if (
          !selectedContainer ||
          selectedContainer.section !== section ||
          selectedContainer.containerId !== containerId
        ) {
          return;
        }

        editingWellIndex = Number(button.dataset.wellIndex);
        const linkedSamples = getLinkedSamples(section, containerId, editingWellIndex);
        editingSampleId = linkedSamples[0]?.id || '';
        wellEditorStatus = '';
        renderSections();
      });
    });

    inventorySections.querySelectorAll('[data-well-sample-select]').forEach((select) => {
      select.addEventListener('change', () => {
        editingSampleId = String(select.value || '');
        wellEditorStatus = '';
        renderSections();
      });
    });

    inventorySections.querySelectorAll('[data-well-sample-save]').forEach((button) => {
      button.addEventListener('click', () => {
        ensureSamples();
        const section = selectedContainer?.section;
        const containerId = selectedContainer?.containerId;
        const index = editingWellIndex;
        if (!section || !containerId || !Number.isInteger(index) || index < 0) {
          return;
        }

        const container = getContainer(section, containerId);
        const sample = getSampleById(button.dataset.wellSampleSave);
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
          wellEditorStatus = 'Sample name is required.';
          renderSections();
          return;
        }

        const code = normalizeSampleCode(codeInput?.value) || sample.code || makeDefaultSampleCode();
        const duplicate = (state.samples || []).find((item) => item.code === code && item.id !== sample.id);
        if (duplicate) {
          wellEditorStatus = `Sample code ${code} already exists.`;
          renderSections();
          return;
        }

        const autoLocation = buildAutoLocationFromLink(section, container, index);
        sample.code = code;
        sample.name = name;
        sample.type = normalizeSampleType(typeInput?.value || sample.type || 'plasmid');
        sample.lot = String(lotInput?.value || '').trim();
        sample.concentration = String(concentrationInput?.value || '').trim();
        sample.notes = String(notesInput?.value || '').trim();
        sample.inventoryLink = {
          section,
          containerId,
          wellIndex: index
        };
        sample.location = isLocationEmpty(sample.location) ? autoLocation : sample.location;
        sample.updatedAt = new Date().toISOString();

        editingSampleId = sample.id;
        wellEditorStatus = `Saved sample ${sample.code || sample.name}.`;
        persist();
        notifySamplesChanged();
        renderSections();
      });
    });

    inventorySections.querySelectorAll('[data-well-sample-unlink]').forEach((button) => {
      button.addEventListener('click', () => {
        ensureSamples();
        const sample = getSampleById(button.dataset.wellSampleUnlink);
        if (!sample) {
          return;
        }
        sample.inventoryLink = null;
        sample.updatedAt = new Date().toISOString();
        editingSampleId = '';
        wellEditorStatus = `Unlinked sample ${sample.code || sample.name || sample.id}.`;
        persist();
        notifySamplesChanged();
        renderSections();
      });
    });

    inventorySections.querySelectorAll('[data-well-sample-create]').forEach((button) => {
      button.addEventListener('click', () => {
        ensureSamples();
        const section = selectedContainer?.section;
        const containerId = selectedContainer?.containerId;
        const index = Number(button.dataset.wellSampleCreate);
        if (!section || !containerId || !Number.isInteger(index) || index < 0) {
          return;
        }

        const container = getContainer(section, containerId);
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
          wellEditorStatus = 'Sample name is required.';
          renderSections();
          return;
        }

        const code = normalizeSampleCode(codeInput?.value) || makeDefaultSampleCode();
        const duplicate = (state.samples || []).find((item) => item.code === code);
        if (duplicate) {
          wellEditorStatus = `Sample code ${code} already exists.`;
          renderSections();
          return;
        }

        const sample = {
          id: `sample-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
          code,
          name,
          type: normalizeSampleType(typeInput?.value || 'plasmid'),
          lot: String(lotInput?.value || '').trim(),
          concentration: String(concentrationInput?.value || '').trim(),
          notes: String(notesInput?.value || '').trim(),
          location: buildAutoLocationFromLink(section, container, index),
          inventoryLink: {
            section,
            containerId,
            wellIndex: index
          },
          chemicalLinks: [],
          updatedAt: new Date().toISOString()
        };

        state.samples.push(sample);
        editingSampleId = sample.id;
        wellEditorStatus = `Created sample ${sample.code}.`;
        persist();
        notifySamplesChanged();
        renderSections();
      });
    });

    inventorySections.querySelectorAll('[data-well-cancel]').forEach((button) => {
      button.addEventListener('click', () => {
        if (!button) {
          return;
        }
        editingWellIndex = -1;
        editingSampleId = '';
        wellEditorStatus = '';
        renderSections();
      });
    });
  }

  return { renderSections };
}
