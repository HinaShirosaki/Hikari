// One shape for every search box: a rounded field with a magnifier on the right
// that runs the search. Views keep writing a plain `<input type="search">`; this
// wraps each one at runtime so no view has to repeat the icon markup.

const LENS_MARKUP = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">'
  + '<circle cx="10.5" cy="10.5" r="6.5"></circle>'
  + '<path d="m15.4 15.4 4.6 4.6"></path>'
  + '</svg>';

export const SEARCH_FIELD_CLASS = 'search-field';
export const SEARCH_LENS_CLASS = 'search-field__lens';

// ponytail: every search box in the app already searches on Enter (live filter
// or explicit handler), so the lens replays Enter instead of each view wiring
// up a second trigger.
export function runSearchInput(input) {
  const KeyboardEventConstructor = input?.ownerDocument?.defaultView?.KeyboardEvent;
  if (typeof KeyboardEventConstructor !== 'function' || !input.dispatchEvent) {
    return false;
  }
  input.focus?.();
  input.dispatchEvent(new KeyboardEventConstructor('keydown', {
    key: 'Enter',
    code: 'Enter',
    bubbles: true,
    cancelable: true
  }));
  return true;
}

export function applySearchFieldLens(input) {
  if (String(input?.tagName || '').toUpperCase() !== 'INPUT') {
    return false;
  }
  if (String(input.getAttribute?.('type') || '').toLowerCase() !== 'search') {
    return false;
  }

  const parent = input.parentNode;
  const documentObject = input.ownerDocument;
  if (!parent || !documentObject?.createElement) {
    return false;
  }
  if (parent.classList?.contains?.(SEARCH_FIELD_CLASS)) {
    return false;
  }

  const field = documentObject.createElement('span');
  field.className = SEARCH_FIELD_CLASS;
  parent.insertBefore(field, input);
  field.appendChild(input);

  const lens = documentObject.createElement('button');
  lens.type = 'button';
  lens.className = SEARCH_LENS_CLASS;
  lens.setAttribute('aria-label', 'Search');
  lens.innerHTML = LENS_MARKUP;
  lens.addEventListener('click', () => runSearchInput(input));
  field.appendChild(lens);
  return true;
}

function refreshSearchFields(root) {
  if (!root) {
    return;
  }
  applySearchFieldLens(root);
  root.querySelectorAll?.('input[type="search"]').forEach(applySearchFieldLens);
}

export function installSearchFieldLens({
  documentObject = document,
  windowObject = window
} = {}) {
  const root = documentObject?.body || documentObject?.documentElement;
  if (!root) {
    return { disconnect() {}, refresh() {} };
  }

  const refresh = () => refreshSearchFields(root);
  refresh();

  const MutationObserverConstructor = windowObject?.MutationObserver;
  if (typeof MutationObserverConstructor !== 'function') {
    return { disconnect() {}, refresh };
  }

  // Views render their own search boxes long after boot, so wrapping is driven
  // by the DOM rather than by every renderer remembering to call refresh().
  const observer = new MutationObserverConstructor((records) => {
    records.forEach((record) => record.addedNodes?.forEach(refreshSearchFields));
  });
  observer.observe(root, { childList: true, subtree: true });

  return {
    disconnect: () => observer.disconnect(),
    refresh
  };
}
