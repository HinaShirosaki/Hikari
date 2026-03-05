export function initPersonalInventory({ state, persist, createId, safeText, cssEscape }) {
  const inventorySections = document.getElementById('inventory-sections');
  const containerDetail = document.getElementById('container-detail');
  const addContainerBtn = document.getElementById('inventory-add-container-btn');
  const addContainerForm = document.getElementById('inventory-add-container-form');
  const addContainerNameInput = document.getElementById('inventory-add-container-name');
  const addContainerLocationSelect = document.getElementById('inventory-add-container-location');
  const addContainerTypeSelect = document.getElementById('inventory-add-container-type');
  const addContainerCancelBtn = document.getElementById('inventory-add-container-cancel');

  let selectedContainer = null;
  let editingWellIndex = null;
  let isAddContainerFormOpen = false;

  if (containerDetail) {
    containerDetail.hidden = true;
  }

  function getContainerTypeLabel(type) {
    return type === 'single' ? 'Single container' : '81-well cube box';
  }

  function getSectionNames() {
    return ['Room Temp', '4 Degree', '-20 Degree', '-80 Degree', 'Liquid Nitrogen'];
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

  function getWellData(rawWell, index) {
    const fallbackName = `W${index + 1}`;
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

  function renderWellEditor(container, index) {
    if (!Number.isInteger(index) || index < 0) {
      return '';
    }

    const well = getWellData(container.wells[index], index);
    return `
      <div class="well-inline-editor">
        <strong>Well ${index + 1}</strong>
        <label>
          Well Name
          <input data-well-name-input="${index}" value="${safeText(well.name)}" placeholder="e.g. A1 or Sample 1" />
        </label>
        <label>
          Well Content
          <textarea data-well-content-input="${index}" rows="3" placeholder="Optional note or content">${safeText(well.content)}</textarea>
        </label>
        <div class="inline-row">
          <button type="button" class="primary-btn" data-well-save="${index}">Save Well</button>
          <button type="button" class="ghost-btn" data-well-cancel>Cancel</button>
        </div>
      </div>
    `;
  }

  function renderContainerDetail(section, container) {
    if (!container) {
      return '';
    }

    if ((container.type || 'box81') !== 'box81') {
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
        </div>
      `;
    }

    const wells = Array.isArray(container.wells) ? container.wells : [];
    const grid = wells.map((rawWell, index) => {
      const well = getWellData(rawWell, index);
      const linkedSamples = getLinkedSamples(section, container.id, index);
      const linkedText = linkedSamples.length
        ? ` | Samples: ${linkedSamples.map((item) => item.code || item.name || item.id).join(', ')}`
        : '';
      const title = well.content ? `${well.name}: ${well.content}${linkedText}` : `${well.name}${linkedText}`;
      return `
        <button
          type="button"
          class="well${editingWellIndex === index ? ' well-selected' : ''}"
          data-well-index="${index}"
          data-section="${safeText(section)}"
          data-container-id="${safeText(container.id)}"
          title="${safeText(title)}"
        >
          ${safeText(well.name)}${linkedSamples.length ? ' *' : ''}
        </button>
      `;
    }).join('');

    return `
      <div class="container-inline-detail">
        <h4>${safeText(section)} / ${safeText(container.name)} (${getContainerTypeLabel(container.type)})</h4>
        <p class="small-note">9 x 9 box (81 wells). Click a well to edit its name/content.</p>
        <div class="well-grid">${grid}</div>
        ${renderWellEditor(container, editingWellIndex)}
      </div>
    `;
  }

  function openContainer(section, containerId) {
    const container = getContainer(section, containerId);
    if (!container) {
      return;
    }

    selectedContainer = { section, containerId };
    editingWellIndex = -1;
    renderSections();
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

    const type = addContainerTypeSelect?.value === 'single' ? 'single' : 'box81';
    const container = {
      id: createId(),
      name,
      type,
      wells: type === 'box81' ? Array.from({ length: 81 }, () => '') : [],
      singleContent: type === 'single' ? '' : undefined
    };

    state.inventory[section] = state.inventory[section] || [];
    state.inventory[section].push(container);
    persist();

    selectedContainer = { section, containerId: container.id };
    editingWellIndex = -1;
    if (addContainerNameInput) {
      addContainerNameInput.value = '';
    }
    setAddContainerFormOpen(false);
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
    inventorySections.innerHTML = getSectionNames().map((section) => {
      const containers = state.inventory[section] || [];
      const items = containers.map((container) => `
        <div class="container-item-row">
          <button
            class="list-main-btn text-list-btn${selectedContainer && selectedContainer.section === section && selectedContainer.containerId === container.id ? ' active' : ''}"
            data-container-open="${container.id}"
            data-section="${safeText(section)}"
          >
            ${safeText(container.name)}
          </button>
          <span class="small-note">Samples: ${getLinkedSamples(section, container.id, null).length + ((container.type || 'box81') === 'box81' ? (container.wells || []).reduce((count, _w, index) => count + getLinkedSamples(section, container.id, index).length, 0) : 0)}</span>
          <button class="danger-btn container-delete-btn" data-container-delete="${container.id}" data-section="${safeText(section)}">Delete</button>
        </div>
        ${selectedContainer && selectedContainer.section === section && selectedContainer.containerId === container.id
    ? renderContainerDetail(section, container)
    : ''}
      `).join('');

      return `
        <section class="inventory-section">
          <h3>${safeText(section)}</h3>
          <div class="stack-form container-items">${items || '<p class="small-note">No containers.</p>'}</div>
        </section>
      `;
    }).join('');

    inventorySections.querySelectorAll('[data-container-open]').forEach((button) => {
      button.addEventListener('click', () => {
        const section = button.dataset.section;
        const containerId = button.dataset.containerOpen;
        if (
          selectedContainer &&
          selectedContainer.section === section &&
          selectedContainer.containerId === containerId
        ) {
          selectedContainer = null;
          editingWellIndex = -1;
          renderSections();
          return;
        }
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
        }

        persist();
        renderSections();
      });
    });

    inventorySections.querySelectorAll('[data-single-container-save]').forEach((button) => {
      button.addEventListener('click', () => {
        const containerId = button.dataset.singleContainerSave;
        const section = selectedContainer?.section;
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
        renderSections();
      });
    });

    inventorySections.querySelectorAll('[data-well-save]').forEach((button) => {
      button.addEventListener('click', () => {
        const section = selectedContainer?.section;
        const containerId = selectedContainer?.containerId;
        if (!section || !containerId) {
          return;
        }

        const container = getContainer(section, containerId);
        if (!container || (container.type || 'box81') !== 'box81') {
          return;
        }

        const index = Number(button.dataset.wellSave);
        const nameInput = inventorySections.querySelector(`[data-well-name-input="${index}"]`);
        const contentInput = inventorySections.querySelector(`[data-well-content-input="${index}"]`);
        const name = nameInput?.value.trim() || `W${index + 1}`;
        const content = contentInput?.value.trim() || '';

        container.wells[index] = { name, content };
        persist();
        renderSections();
      });
    });

    inventorySections.querySelectorAll('[data-well-cancel]').forEach((button) => {
      button.addEventListener('click', () => {
        if (!button) {
          return;
        }
        editingWellIndex = -1;
        renderSections();
      });
    });
  }

  return { renderSections };
}
