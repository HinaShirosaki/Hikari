import {
  buildSamplePlaceholderTypeAliases,
  formatSampleRecordLabel,
  formatSampleStorageLabel,
  normalizeSampleType,
  resolveSampleTypeForPlaceholder
} from './sample-helpers.js';

let nextListId = 0;

export function matchPlaceholderSamples(samples, name, query, settings = {}) {
  const type = resolveSampleTypeForPlaceholder(name, buildSamplePlaceholderTypeAliases(settings));
  const needle = String(query || '').trim().toLowerCase();
  if (!type || !needle) return [];
  const rank = (sample) => {
    const fields = [sample.name, sample.code].map(value => String(value || '').toLowerCase());
    return fields.includes(needle) ? 0 : fields.some(value => value.startsWith(needle)) ? 1 : 2;
  };
  return (Array.isArray(samples) ? samples : [])
    .filter(sample => sample?.id && normalizeSampleType(sample.type) === type
      && formatSampleRecordLabel(sample).toLowerCase().includes(needle))
    .sort((a, b) => rank(a) - rank(b)
      || formatSampleRecordLabel(a).localeCompare(formatSampleRecordLabel(b), undefined, { numeric: true, sensitivity: 'base' }))
    .slice(0, 12);
}

export function createPlaceholderSuggestions({
  stepsHost, getSamples, getSettings, getInventory, onSelect
}) {
  let active = null;

  function close() {
    if (!active) return;
    const { editor, list, doc, observer } = active;
    active = null;
    observer?.disconnect();
    doc.removeEventListener('scroll', onScroll, true);
    doc.defaultView.removeEventListener('resize', close);
    editor.setAttribute('aria-expanded', 'false');
    editor.removeAttribute('aria-activedescendant');
    editor.removeAttribute('aria-controls');
    list.remove();
  }

  function onScroll(event) {
    if (!active?.list.contains(event.target)) close();
  }

  function choose(index) {
    if (!active) return;
    const { editor, candidates, query, name } = active;
    // Resolve the current record if samples changed while the popup was open.
    const sample = matchPlaceholderSamples(getSamples(), name, query, getSettings())
      .find(item => item.id === candidates[index]?.id);
    close();
    if (sample && editor.isConnected && !editor.hidden) onSelect(editor, sample);
  }

  function update(editor) {
    close();
    const wrap = editor.closest('[data-inline-placeholder]');
    const name = wrap?.dataset.placeholderName || '';
    const query = editor.value.trim();
    const candidates = matchPlaceholderSamples(getSamples(), name, query, getSettings());
    if (!candidates.length || !editor.ownerDocument || editor.hidden) return;
    const doc = editor.ownerDocument;
    const win = doc.defaultView;
    const list = doc.createElement('div');
    list.id = `notebook-sample-suggestions-${++nextListId}`;
    list.className = 'biology-notebook-sample-suggestions';
    list.setAttribute('popover', 'manual');
    list.setAttribute('role', 'listbox');
    list.setAttribute('aria-label', `${name} samples`);
    for (const [index, sample] of candidates.entries()) {
      const option = doc.createElement('div');
      option.id = `${list.id}-${index}`;
      option.dataset.notebookSampleOption = String(index);
      option.setAttribute('role', 'option');
      option.setAttribute('aria-selected', 'false');
      const title = doc.createElement('span');
      title.textContent = formatSampleRecordLabel(sample);
      const detail = doc.createElement('span');
      detail.className = 'biology-notebook-sample-suggestion-detail';
      detail.textContent = [sample.lot && `Lot: ${sample.lot}`, formatSampleStorageLabel(sample, getInventory())].filter(Boolean).join(' · ');
      option.append(title, detail);
      list.append(option);
    }
    // A top-layer popup remains visible outside clipped notebook step panels.
    wrap.append(list);
    const rect = editor.getBoundingClientRect();
    const width = Math.min(Math.max(rect.width, 280), win.innerWidth - 24);
    list.style.width = `${width}px`;
    list.style.left = `${Math.max(12, Math.min(rect.left, win.innerWidth - width - 12))}px`;
    list.style.top = `${rect.bottom + 2}px`;
    const below = win.innerHeight - rect.bottom - 14;
    if (below < 100 && rect.top > below) {
      list.style.top = 'auto';
      list.style.bottom = `${win.innerHeight - rect.top + 2}px`;
      list.style.maxHeight = `${Math.min(224, rect.top - 14)}px`;
    } else {
      list.style.maxHeight = `${Math.max(32, Math.min(224, below))}px`;
    }
    editor.setAttribute('role', 'combobox');
    editor.setAttribute('aria-label', name);
    editor.setAttribute('aria-autocomplete', 'list');
    editor.setAttribute('aria-expanded', 'true');
    editor.setAttribute('aria-controls', list.id);
    editor.setAttribute('autocomplete', 'off');
    active = { editor, list, candidates, query, name, doc, index: -1 };
    list.addEventListener('mousedown', event => event.preventDefault());
    list.addEventListener('click', event => {
      const option = event.target.closest('[data-notebook-sample-option]');
      if (option && list.contains(option)) {
        event.preventDefault();
        event.stopPropagation();
        choose(Number(option.dataset.notebookSampleOption));
      }
    });
    list.showPopover();
    doc.addEventListener('scroll', onScroll, true);
    win.addEventListener('resize', close);
    active.observer = new win.MutationObserver(() => {
      if (active && (!editor.isConnected || editor.hidden)) close();
    });
    active.observer.observe(stepsHost, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
  }

  function onKeydown(event) {
    if (!active || event.target !== active.editor || event.isComposing) return false;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
      return true;
    }
    if (event.key === 'Enter' && active.index >= 0) {
      event.preventDefault();
      choose(active.index);
      return true;
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return false;
    event.preventDefault();
    const { list, candidates, editor } = active;
    const step = event.key === 'ArrowDown' ? 1 : -1;
    active.index = active.index < 0 ? (step > 0 ? 0 : candidates.length - 1)
      : (active.index + step + candidates.length) % candidates.length;
    Array.from(list.children).forEach((option, index) => option.setAttribute('aria-selected', String(index === active.index)));
    const option = list.children[active.index];
    editor.setAttribute('aria-activedescendant', option.id);
    option.scrollIntoView({ block: 'nearest' });
    return true;
  }

  return { update, close, onKeydown };
}
