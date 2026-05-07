import {
  formatSampleRecordLabel,
  formatSampleStorageLabel,
  getSampleTypeLabel,
  normalizeSampleLookupText,
  normalizeSampleType
} from './sample-helpers.js';

function getSampleLinkSearchResults({ samples, inventory, placeholderType, query }) {
  const normalizedType = normalizeSampleType(placeholderType);
  const normalizedQuery = normalizeSampleLookupText(query);
  const sourceSamples = Array.isArray(samples) ? samples : [];
  return sourceSamples
    .filter((sample) => normalizeSampleType(sample?.type) === normalizedType)
    .filter((sample) => {
      if (!normalizedQuery) {
        return true;
      }
      const haystack = normalizeSampleLookupText([
        sample?.code,
        sample?.name,
        sample?.type,
        sample?.lot,
        sample?.concentration,
        formatSampleStorageLabel(sample, inventory),
        sample?.notes
      ].join(' '));
      return haystack.includes(normalizedQuery);
    })
    .sort((left, right) => {
      const leftUpdated = new Date(left?.updatedAt || 0).getTime();
      const rightUpdated = new Date(right?.updatedAt || 0).getTime();
      return rightUpdated - leftUpdated;
    })
    .slice(0, 30);
}

export function createSampleLinkMenuController({
  doc = (typeof document !== 'undefined' ? document : null),
  win = (typeof window !== 'undefined' ? window : null),
  getSamples,
  getInventory,
  safeText,
  onSelect
} = {}) {
  let menu = null;
  let menuState = null;

  function ensureMenu() {
    if (menu || !doc?.createElement) {
      return menu;
    }
    menu = doc.createElement('div');
    menu.className = 'biology-notebook-sample-link-menu';
    menu.setAttribute('role', 'menu');
    menu.hidden = true;
    doc.body?.append(menu);
    return menu;
  }

  function close() {
    if (menu) {
      menu.hidden = true;
      menu.innerHTML = '';
    }
    menuState = null;
  }

  function position(x, y) {
    if (!menu) {
      return;
    }
    const menuWidth = 320;
    const menuHeight = 360;
    const viewportWidth = win?.innerWidth || doc?.documentElement?.clientWidth || menuWidth;
    const viewportHeight = win?.innerHeight || doc?.documentElement?.clientHeight || menuHeight;
    const left = Math.max(12, Math.min(Number(x) || 12, viewportWidth - menuWidth - 12));
    const top = Math.max(12, Math.min(Number(y) || 12, viewportHeight - menuHeight - 12));
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
  }

  function renderResults() {
    if (!menu || !menuState) {
      return;
    }
    const resultsHost = menu.querySelector('[data-sample-link-results]');
    if (!resultsHost) {
      return;
    }
    const samples = getSampleLinkSearchResults({
      samples: typeof getSamples === 'function' ? getSamples() : [],
      inventory: typeof getInventory === 'function' ? getInventory() : {},
      placeholderType: menuState.placeholderType,
      query: menuState.query
    });
    if (!samples.length) {
      resultsHost.innerHTML = `
        <p class="small-note biology-notebook-sample-link-empty">
          No ${safeText(getSampleTypeLabel(menuState.placeholderType))} samples found.
        </p>
      `;
      return;
    }
    const inventory = typeof getInventory === 'function' ? getInventory() : {};
    resultsHost.innerHTML = samples.map((sample) => {
      const storageLabel = formatSampleStorageLabel(sample, inventory);
      return `
        <button type="button" class="biology-notebook-sample-link-option" data-sample-link-select="${safeText(sample.id)}">
          <span class="biology-notebook-sample-link-option-main">${safeText(formatSampleRecordLabel(sample))}</span>
          <span class="biology-notebook-sample-link-option-meta">${safeText(`${getSampleTypeLabel(sample.type)} - ${storageLabel}`)}</span>
        </button>
      `;
    }).join('');
  }

  function onResultsClick(event) {
    const option = event.target.closest('[data-sample-link-select]');
    if (!option || !menuState || typeof onSelect !== 'function') {
      return;
    }
    const samples = typeof getSamples === 'function' ? getSamples() : [];
    const sample = samples.find((item) => item.id === option.dataset.sampleLinkSelect);
    if (!sample) {
      return;
    }
    onSelect(sample, menuState);
  }

  function open({ wrap, token, x, y }) {
    const key = String(token?.dataset?.nbKeyRef || '').trim();
    const placeholderName = String(wrap?.dataset?.placeholderName || '').trim();
    const placeholderType = String(wrap?.dataset?.samplePlaceholderType || '').trim();
    if (!key || !placeholderType) {
      return;
    }
    const menuEl = ensureMenu();
    if (!menuEl) {
      return;
    }
    menuState = {
      wrap,
      key,
      placeholderName,
      placeholderType,
      query: ''
    };
    menuEl.innerHTML = `
      <div class="biology-notebook-sample-link-menu-head">
        <strong>Link ${safeText(getSampleTypeLabel(placeholderType))}</strong>
        <span class="small-note">${safeText(placeholderName || 'Placeholder')}</span>
      </div>
      <input
        type="search"
        class="biology-notebook-sample-link-search"
        data-sample-link-search
        placeholder="Search samples..."
        aria-label="Search samples"
      />
      <div class="biology-notebook-sample-link-results" data-sample-link-results></div>
    `;
    const searchInput = menuEl.querySelector('[data-sample-link-search]');
    searchInput?.addEventListener('input', () => {
      if (!menuState) {
        return;
      }
      menuState.query = searchInput.value || '';
      renderResults();
    });
    menuEl.querySelector('[data-sample-link-results]')?.addEventListener('click', onResultsClick);
    renderResults();
    position(x, y);
    menuEl.hidden = false;
    searchInput?.focus();
  }

  function isOpenAt(target) {
    return Boolean(menu) && !menu.hidden && menu.contains(target);
  }

  function isOpen() {
    return Boolean(menu) && !menu.hidden;
  }

  return {
    open,
    close,
    isOpen,
    isOpenAt
  };
}
