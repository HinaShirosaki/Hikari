export function createInventorySamplePicker({
  safeText,
  getInventorySamples,
  getEffectiveWellMapping,
  setActiveWellSelection,
  applyInventorySample
}) {
  const state = { wellId: '', query: '' };
  const root = document.createElement('div');
  root.className = 'assay-sample-picker';
  root.hidden = true;
  document.body.append(root);

  function inventorySampleDisplayValue(sample) {
    return String(sample?.code || sample?.name || sample?.id || '').trim();
  }

  function findInventorySampleRecordBySampleId(sampleId) {
    const target = String(sampleId || '').trim();
    if (!target) {
      return null;
    }
    return (typeof getInventorySamples === 'function' ? getInventorySamples() : []).find((sample) => {
      const candidates = [
        inventorySampleDisplayValue(sample),
        sample?.code,
        sample?.name,
        sample?.id
      ]
        .map((value) => String(value || '').trim())
        .filter(Boolean);
      return candidates.includes(target);
    }) || null;
  }

  function getInventorySampleOptions() {
    return (typeof getInventorySamples === 'function' ? getInventorySamples() : [])
      .map((sample) => {
        const code = String(sample?.code || '').trim();
        const name = String(sample?.name || '').trim();
        const type = String(sample?.type || '').trim();
        const concentration = String(sample?.concentration || '').trim();
        const value = inventorySampleDisplayValue(sample);
        if (!value) {
          return null;
        }
        return {
          id: String(sample?.id || '').trim(),
          value,
          code,
          name,
          type,
          concentration,
          searchText: [
            value,
            code,
            name,
            type,
            concentration,
            sample?.lot,
            sample?.notes
          ].join(' ').toLowerCase()
        };
      })
      .filter(Boolean)
      .sort((left, right) => left.value.localeCompare(right.value, undefined, { sensitivity: 'base' }));
  }

  function hide() {
    state.wellId = '';
    state.query = '';
    root.hidden = true;
    root.innerHTML = '';
  }

  function position(clientX, clientY) {
    const margin = 12;
    const rect = root.getBoundingClientRect();
    const maxLeft = Math.max(margin, window.innerWidth - rect.width - margin);
    const maxTop = Math.max(margin, window.innerHeight - rect.height - margin);
    root.style.left = `${Math.min(Math.max(margin, clientX), maxLeft)}px`;
    root.style.top = `${Math.min(Math.max(margin, clientY), maxTop)}px`;
  }

  function render() {
    if (!state.wellId) {
      hide();
      return;
    }

    const options = getInventorySampleOptions();
    const query = state.query.trim().toLowerCase();
    const filtered = query
      ? options.filter((item) => item.searchText.includes(query))
      : options;
    const currentValue = getEffectiveWellMapping(state.wellId).sampleId;

    root.innerHTML = `
      <div class="assay-sample-picker-head">
        <strong>Select Sample</strong>
        <span>${safeText(state.wellId)}</span>
      </div>
      <div class="assay-sample-picker-search">
        <input
          type="search"
          class="assay-sample-picker-search-input"
          value="${safeText(state.query)}"
          placeholder="Search inventory samples"
          aria-label="Search inventory samples"
        />
      </div>
      <div class="assay-sample-picker-list">
        ${currentValue ? `
          <button type="button" class="assay-sample-picker-item assay-sample-picker-clear" data-assay-sample-picker-clear="true">
            <span class="assay-sample-picker-item-title">Clear Sample</span>
            <span class="assay-sample-picker-item-meta">Remove the Sample ID for ${safeText(state.wellId)}</span>
          </button>
        ` : ''}
        ${filtered.length ? filtered.map((item) => `
          <button
            type="button"
            class="assay-sample-picker-item${item.value === currentValue ? ' is-current' : ''}"
            data-assay-sample-picker-value="${safeText(item.value)}"
            title="${safeText(item.name || item.value)}"
          >
            <span class="assay-sample-picker-item-title">${safeText(item.value)}</span>
            <span class="assay-sample-picker-item-meta">${safeText([
              item.name && item.name !== item.value ? item.name : '',
              item.type || '',
              item.concentration || ''
            ].filter(Boolean).join(' • ') || 'Inventory sample')}</span>
          </button>
        `).join('') : '<p class="small-note assay-sample-picker-empty">No inventory samples match this search.</p>'}
      </div>
    `;
    root.hidden = false;

    const searchInput = root.querySelector('.assay-sample-picker-search-input');
    searchInput?.addEventListener('input', (event) => {
      state.query = String(event.target?.value || '');
      render();
      const nextInput = root.querySelector('.assay-sample-picker-search-input');
      nextInput?.focus();
      nextInput?.setSelectionRange(state.query.length, state.query.length);
    });

    root.querySelectorAll('[data-assay-sample-picker-value]').forEach((button) => {
      button.addEventListener('click', () => {
        const wellId = state.wellId;
        const nextValue = String(button.getAttribute('data-assay-sample-picker-value') || '').trim();
        hide();
        if (!wellId) {
          return;
        }
        applyInventorySample(wellId, nextValue);
      });
    });

    root.querySelector('[data-assay-sample-picker-clear="true"]')?.addEventListener('click', () => {
      const wellId = state.wellId;
      hide();
      if (!wellId) {
        return;
      }
      applyInventorySample(wellId, '');
    });
  }

  function show(wellId, clientX, clientY) {
    const normalizedWell = String(wellId || '').trim().toUpperCase();
    if (!normalizedWell) {
      return;
    }
    state.wellId = normalizedWell;
    state.query = '';
    setActiveWellSelection(normalizedWell);
    render();
    position(clientX, clientY);
    root.querySelector('.assay-sample-picker-search-input')?.focus();
  }

  function isOpen() {
    return !root.hidden;
  }

  function containsTarget(target) {
    return Boolean(target?.closest?.('.assay-sample-picker'));
  }

  return {
    show,
    hide,
    isOpen,
    containsTarget,
    findInventorySampleRecordBySampleId
  };
}
