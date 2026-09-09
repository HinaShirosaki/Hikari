const fieldPairs = [
  ['#sample-name', '#sample-type'],
  ...['single', 'well'].flatMap((kind) => ['', 'new-'].map((mode) => [
    `[data-${kind}-sample-${mode}name]`, `[data-${kind}-sample-${mode}type]`
  ]))
];
let nextListId = 0;

export function matchPlasmidNames(entries, query) {
  const needle = String(query || '').trim().toLowerCase();
  if (!needle) return [];
  // The DNA library has no plasmid classification. Include linear imports too,
  // since an imported plasmid can have unspecified/linear topology.
  const names = new Map();
  for (const entry of entries || []) {
    const name = String(entry?.name || '').trim();
    const key = name.toLowerCase();
    if (key.includes(needle) && !names.has(key)) names.set(key, name);
  }
  return [...names.values()].sort((a, b) => {
    const rank = (name) => name.toLowerCase() === needle ? 0 : name.toLowerCase().startsWith(needle) ? 1 : 2;
    return rank(a) - rank(b) || a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
  }).slice(0, 12);
}

export function bindPlasmidNameSuggestions(root, state, {
  getBridge = () => globalThis.window?.hikariApi,
  delay = 180
} = {}) {
  if (!root?.addEventListener) return;
  const doc = root.ownerDocument;
  const controls = new WeakMap();
  let active = null;
  let timer;
  let revision = 0;

  function close() {
    clearTimeout(timer);
    revision += 1;
    if (!active) return;
    active.list.hidden = true;
    active.input.setAttribute('aria-expanded', 'false');
    active.input.removeAttribute('aria-activedescendant');
    active.index = -1;
  }

  function getControl(target, isType = false) {
    const pair = fieldPairs.find((selectors) => target?.matches?.(selectors[isType ? 1 : 0]));
    if (!pair) return null;
    const input = isType ? root.querySelector(pair[0]) : target;
    const type = root.querySelector(pair[1]);
    if (!input || !type) return null;
    if (controls.has(input)) return controls.get(input);
    const list = doc.createElement('span');
    list.id = `sample-plasmid-suggestions-${++nextListId}`;
    list.className = 'sample-plasmid-suggestions';
    list.hidden = true;
    list.setAttribute('role', 'listbox');
    list.setAttribute('aria-label', 'Sequence Viewer matches');
    input.insertAdjacentElement('afterend', list);
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-label', 'Sample Name');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-controls', list.id);
    input.setAttribute('aria-expanded', 'false');
    input.setAttribute('autocomplete', 'off');
    const control = { input, type, list, names: [], index: -1 };
    controls.set(input, control);
    // Keep focus on the input so a pointer selection survives focusout.
    list.addEventListener('mousedown', (event) => event.preventDefault());
    list.addEventListener('click', (event) => {
      const option = event.target.closest('[data-plasmid-option]');
      if (option && list.contains(option)) {
        event.preventDefault();
        choose(control, Number(option.dataset.plasmidOption));
      }
    });
    return control;
  }

  function choose(control, index) {
    const name = control.names[index];
    if (!name || control.type.value !== 'plasmid') return;
    control.input.value = name;
    control.input.focus();
    control.input.dispatchEvent(new doc.defaultView.Event('input', { bubbles: true }));
    control.input.dispatchEvent(new doc.defaultView.Event('change', { bubbles: true }));
    close();
  }

  function show(control, names, message = '') {
    control.names = names;
    control.index = -1;
    control.list.replaceChildren();
    for (const [index, name] of names.entries()) {
      const option = doc.createElement('span');
      option.id = `${control.list.id}-${index}`;
      option.dataset.plasmidOption = String(index);
      option.setAttribute('role', 'option');
      option.setAttribute('aria-selected', 'false');
      option.textContent = name;
      control.list.append(option);
    }
    if (message) {
      const note = doc.createElement('span');
      note.className = 'sample-plasmid-suggestions-note';
      note.setAttribute('role', 'status');
      note.textContent = message;
      control.list.append(note);
    }
    control.list.hidden = !names.length && !message;
    control.input.setAttribute('aria-expanded', String(!control.list.hidden));
  }

  function search(control) {
    close();
    active = control;
    const query = control.input.value.trim();
    if (control.type.value !== 'plasmid' || !query) return;
    const currentRevision = revision;
    const storagePath = String(state.settings?.storagePath || '').trim();
    const isCurrent = () => currentRevision === revision
      && root.contains(control.input) && control.input.isConnected
      && control.input.value.trim() === query && control.type.value === 'plasmid'
      && String(state.settings?.storagePath || '').trim() === storagePath
      && (doc.activeElement === control.input || doc.activeElement === control.type);
    timer = setTimeout(async () => {
      if (!isCurrent()) return;
      try {
        const bridge = getBridge();
        if (!storagePath) {
          show(control, [], 'Set a Storage Folder Path in Settings to search sequences.');
          return;
        }
        if (!bridge?.sequenceLibraryList) throw new Error('Unavailable');
        const response = await bridge.sequenceLibraryList({
          storagePath,
          projects: (state.projects || []).map(({ id, name }) => ({ id, name }))
        });
        if (!isCurrent()) return;
        if (!response?.ok) throw new Error('Search failed');
        show(control, matchPlasmidNames(response.entries, query));
      } catch {
        if (isCurrent()) show(control, [], 'Could not search Sequence Viewer. Type again to retry.');
      }
    }, delay);
  }

  root.addEventListener('input', (event) => {
    const control = getControl(event.target);
    if (control) search(control);
  });
  root.addEventListener('focusin', (event) => {
    const control = getControl(event.target);
    if (control) search(control);
  });
  root.addEventListener('change', (event) => {
    const control = getControl(event.target, true);
    if (control) search(control);
  });
  root.addEventListener('focusout', (event) => {
    if (event.target === active?.input || event.target === active?.type) close();
  });
  root.addEventListener('reset', close);
  root.addEventListener('keydown', (event) => {
    if (event.target !== active?.input || event.isComposing) return;
    if (event.key === 'Escape') {
      const wasOpen = !active.list.hidden;
      close();
      if (wasOpen) { event.preventDefault(); event.stopPropagation(); }
      return;
    }
    if (active.list.hidden || !active.names.length) return;
    if (event.key === 'Enter' && active.index >= 0) {
      event.preventDefault();
      choose(active, active.index);
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      active.index = active.index < 0
        ? (step > 0 ? 0 : active.names.length - 1)
        : (active.index + step + active.names.length) % active.names.length;
      Array.from(active.list.children).forEach((option, index) => {
        option.setAttribute('aria-selected', String(index === active.index));
      });
      const option = active.list.children[active.index];
      active.input.setAttribute('aria-activedescendant', option.id);
      option.scrollIntoView({ block: 'nearest' });
    }
  });
}
