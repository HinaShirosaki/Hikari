import { createPresentation } from "../../lib/i18n/presentation.js";
import "../../lib/i18n/shell.js";
const i18nUi = createPresentation("shell");
import { searchCandidateMarkup } from '../topbar-search/localization.js';

// Dropdown state for the topbar search box: render the list, move focus with
// the arrow keys, and apply the chosen suggestion.
function createSearchSuggestions({
  documentObject,
  topbarSearchInput,
  topbarSearchSuggestions,
  getSearchSuggestions,
  applySearchSuggestion
} = {}) {
  let suggestionsState = {
    items: [],
    activeIndex: -1,
    open: false
  };

  function renderSearchSuggestionList() {
    if (!topbarSearchSuggestions) {
      return;
    }
    const { items, activeIndex, open } = suggestionsState;
    if (!open || items.length === 0) {
      topbarSearchSuggestions.hidden = true;
      topbarSearchSuggestions.replaceChildren();
      topbarSearchInput?.setAttribute('aria-expanded', 'false');
      topbarSearchInput?.removeAttribute('aria-activedescendant');
      return;
    }
    topbarSearchSuggestions.hidden = false;
    topbarSearchInput?.setAttribute('aria-expanded', 'true');

    const fragment = documentObject.createDocumentFragment();
    items.forEach((item, index) => {
      const li = documentObject.createElement('li');
      li.className = 'topbar-search-suggestion';
      li.setAttribute('role', 'option');
      li.id = `topbar-search-suggestion-${index}`;
      li.dataset.index = String(index);
      li.classList.toggle('is-active', index === activeIndex);
      li.setAttribute('aria-selected', index === activeIndex ? 'true' : 'false');

      const display = searchCandidateMarkup(item);
      const kindHtml = item.kind
        ? `<span class="topbar-search-suggestion-kind">${display.kind}</span>`
        : '';
      const sublabelHtml = item.sublabel
        ? `<span class="topbar-search-suggestion-sublabel">${display.sublabel}</span>`
        : '';

      i18nUi.setHtml(li, `
        <span class="topbar-search-suggestion-body">
          <span class="topbar-search-suggestion-label">${display.label}</span>
          ${sublabelHtml}
        </span>
        ${kindHtml}
      `);
      fragment.appendChild(li);
    });
    topbarSearchSuggestions.replaceChildren(fragment);

    if (activeIndex >= 0 && activeIndex < items.length) {
      topbarSearchInput?.setAttribute('aria-activedescendant', `topbar-search-suggestion-${activeIndex}`);
    } else {
      topbarSearchInput?.removeAttribute('aria-activedescendant');
    }
  }

  function closeSearchSuggestions() {
    if (!suggestionsState.open && suggestionsState.items.length === 0) {
      return;
    }
    suggestionsState = { items: [], activeIndex: -1, open: false };
    renderSearchSuggestionList();
  }

  function refreshSearchSuggestions() {
    if (!topbarSearchSuggestions || !topbarSearchInput) {
      return;
    }
    const rawQuery = topbarSearchInput.value || '';
    if (!rawQuery.trim()) {
      closeSearchSuggestions();
      return;
    }
    const items = getSearchSuggestions(rawQuery, { limit: 8 }) || [];
    if (!items.length) {
      suggestionsState = { items: [], activeIndex: -1, open: false };
      renderSearchSuggestionList();
      return;
    }
    suggestionsState = {
      items,
      activeIndex: items.length ? 0 : -1,
      open: true
    };
    renderSearchSuggestionList();
  }

  function moveSearchSuggestionFocus(delta) {
    const { items } = suggestionsState;
    if (!suggestionsState.open || items.length === 0) {
      return;
    }
    const total = items.length;
    const current = suggestionsState.activeIndex;
    const next = current < 0
      ? (delta > 0 ? 0 : total - 1)
      : (current + delta + total) % total;
    suggestionsState = { ...suggestionsState, activeIndex: next };
    renderSearchSuggestionList();
    const target = topbarSearchSuggestions?.querySelector(`[data-index="${next}"]`);
    if (target && typeof target.scrollIntoView === 'function') {
      target.scrollIntoView({ block: 'nearest' });
    }
  }

  function selectSearchSuggestion(index) {
    const item = suggestionsState.items[index];
    if (!item) {
      return false;
    }
    closeSearchSuggestions();
    if (topbarSearchInput) {
      topbarSearchInput.value = '';
      i18nUi.setAttribute(topbarSearchInput, "title", i18nUi.message("Opened {p0}: {p1}", { p0: item.kind || item.target?.label || 'view', p1: item.label }));
    }
    return applySearchSuggestion(item);
  }

  // Hover moves the highlight without re-querying; the list is already rendered.
  function setSuggestionActiveIndex(index) {
    suggestionsState = { ...suggestionsState, activeIndex: index };
    renderSearchSuggestionList();
  }

  return {
    getSuggestionsState: () => suggestionsState,
    setSuggestionActiveIndex,
    renderSearchSuggestionList,
    closeSearchSuggestions,
    refreshSearchSuggestions,
    moveSearchSuggestionFocus,
    selectSearchSuggestion
  };
}

export { createSearchSuggestions };
