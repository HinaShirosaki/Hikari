import { escapeHtml } from './html.js';

function normalizeFolderTreeKey(value) {
  return String(value || '').trim();
}

function normalizeFolderTreeKeys(values = []) {
  return [...new Set(
    (Array.isArray(values) ? values : [...(values || [])])
      .map((value) => normalizeFolderTreeKey(value))
      .filter(Boolean)
  )];
}

function joinClassNames(...values) {
  return values
    .flatMap((value) => String(value || '').split(/\s+/))
    .map((value) => value.trim())
    .filter(Boolean)
    .filter((value, index, items) => items.indexOf(value) === index)
    .join(' ');
}

function renderAttributes(attributes = {}) {
  return Object.entries(attributes || {})
    .map(([rawName, rawValue]) => {
      const name = String(rawName || '').trim();
      if (!name || rawValue === false || rawValue === null || rawValue === undefined) {
        return '';
      }
      if (rawValue === true) {
        return ` ${escapeHtml(name)}`;
      }
      return ` ${escapeHtml(name)}="${escapeHtml(rawValue)}"`;
    })
    .join('');
}

export function createFolderTreeState({
  defaultExpanded = true,
  getExpandedKeys = null,
  setExpandedKeys = null,
  getCollapsedKeys = null,
  setCollapsedKeys = null
} = {}) {
  const expandedKeys = new Set();
  const collapsedKeys = new Set();

  function readKeys(type) {
    const readExternal = type === 'expanded' ? getExpandedKeys : getCollapsedKeys;
    const localKeys = type === 'expanded' ? expandedKeys : collapsedKeys;
    if (typeof readExternal !== 'function') {
      return new Set(localKeys);
    }
    return new Set(normalizeFolderTreeKeys(readExternal()));
  }

  function writeKeys(type, values) {
    const normalized = normalizeFolderTreeKeys(values);
    const writeExternal = type === 'expanded' ? setExpandedKeys : setCollapsedKeys;
    const localKeys = type === 'expanded' ? expandedKeys : collapsedKeys;
    localKeys.clear();
    normalized.forEach((key) => localKeys.add(key));
    if (typeof writeExternal === 'function') {
      writeExternal([...normalized]);
    }
    return normalized;
  }

  function isExpanded(rawKey, hasChildren = true) {
    const key = normalizeFolderTreeKey(rawKey);
    if (!key || !hasChildren) {
      return false;
    }
    const keys = readKeys(defaultExpanded ? 'collapsed' : 'expanded');
    return defaultExpanded ? !keys.has(key) : keys.has(key);
  }

  function setExpanded(rawKey, expanded = true) {
    const key = normalizeFolderTreeKey(rawKey);
    if (!key) {
      return false;
    }
    const type = defaultExpanded ? 'collapsed' : 'expanded';
    const keys = readKeys(type);
    if (defaultExpanded ? expanded : !expanded) {
      keys.delete(key);
    } else {
      keys.add(key);
    }
    writeKeys(type, keys);
    return expanded;
  }

  function toggle(rawKey, hasChildren = true) {
    const nextExpanded = !isExpanded(rawKey, hasChildren);
    return setExpanded(rawKey, nextExpanded);
  }

  function reveal(rawKeys = []) {
    normalizeFolderTreeKeys(rawKeys).forEach((key) => setExpanded(key, true));
  }

  function prune(rawKeys = []) {
    const validKeys = new Set(normalizeFolderTreeKeys(rawKeys));
    const type = defaultExpanded ? 'collapsed' : 'expanded';
    const keys = readKeys(type);
    [...keys].forEach((key) => {
      if (!validKeys.has(key)) {
        keys.delete(key);
      }
    });
    return writeKeys(type, keys);
  }

  function getState() {
    return {
      defaultExpanded,
      expandedKeys: defaultExpanded ? [] : [...readKeys('expanded')],
      collapsedKeys: defaultExpanded ? [...readKeys('collapsed')] : []
    };
  }

  return {
    isExpanded,
    setExpanded,
    toggle,
    reveal,
    prune,
    getState
  };
}

export function renderFolderTreeNode({
  key = '',
  expanded = false,
  active = false,
  expandable = true,
  label = '',
  labelHtml = '',
  meta = '',
  metaHtml = '',
  childrenHtml = '',
  actionHtml = '',
  mainHtml = '',
  disclosureLabel = '',
  nodeClass = '',
  rowClass = '',
  disclosureClass = '',
  mainClass = '',
  labelClass = '',
  metaClass = '',
  childrenClass = '',
  glyphClass = '',
  nodeAttributes = {},
  rowAttributes = {},
  disclosureAttributes = {},
  mainAttributes = {},
  childrenAttributes = {}
} = {}) {
  const normalizedKey = normalizeFolderTreeKey(key);
  const nodeClasses = joinClassNames(
    nodeClass,
    'folder-tree-template__node',
    active && 'is-active',
    expanded && 'is-expanded'
  );
  const rowClasses = joinClassNames(
    rowClass,
    'folder-tree-template__row',
    active && 'is-active',
    expanded && 'is-expanded'
  );
  const disclosure = expandable ? `
    <button
      type="button"
      class="${joinClassNames(disclosureClass, 'folder-tree-template__disclosure')}"
      data-folder-tree-toggle="${escapeHtml(normalizedKey)}"
      aria-expanded="${expanded ? 'true' : 'false'}"
      aria-label="${escapeHtml(disclosureLabel || `${expanded ? 'Collapse' : 'Expand'} ${label || 'folder'}`)}"
      ${renderAttributes(disclosureAttributes)}
    >
      <span class="folder-tree-template__chevron" aria-hidden="true"></span>
    </button>
  ` : '<span class="folder-tree-template__disclosure-spacer" aria-hidden="true"></span>';
  const main = mainHtml || `
    <button
      type="button"
      class="${joinClassNames(mainClass, 'folder-tree-template__main')}"
      ${renderAttributes(mainAttributes)}
    >
      <span class="${joinClassNames(glyphClass, 'left-rail-folder-glyph')}" aria-hidden="true"></span>
      <span class="${joinClassNames(labelClass, 'folder-tree-template__label')}">${labelHtml || escapeHtml(label)}</span>
      ${(metaHtml || meta !== '') ? `<span class="${joinClassNames(metaClass, 'folder-tree-template__meta')}">${metaHtml || escapeHtml(meta)}</span>` : ''}
    </button>
  `;
  const action = actionHtml || '<span class="folder-tree-template__action-spacer" aria-hidden="true"></span>';
  const children = expandable ? `
    <div
      class="${joinClassNames(childrenClass, 'folder-tree-template__children')}"
      ${expanded ? '' : 'hidden'}
      ${renderAttributes(childrenAttributes)}
    >${childrenHtml}</div>
  ` : '';

  return `
    <div
      class="${nodeClasses}"
      data-folder-tree-key="${escapeHtml(normalizedKey)}"
      ${renderAttributes(nodeAttributes)}
    >
      <div class="${rowClasses}" ${renderAttributes(rowAttributes)}>
        ${disclosure}
        ${main}
        ${action}
      </div>
      ${children}
    </div>
  `;
}

export function renderFolderTreeLeaf({
  active = false,
  wrapperClass = '',
  controlClass = '',
  contentHtml = '',
  controlTag = 'button',
  wrapperAttributes = {},
  controlAttributes = {}
} = {}) {
  const safeControlTag = controlTag === 'div' ? 'div' : 'button';
  const typeAttribute = safeControlTag === 'button' ? ' type="button"' : '';
  return `
    <div class="${joinClassNames(wrapperClass, 'folder-tree-template__leaf')}" ${renderAttributes(wrapperAttributes)}>
      <${safeControlTag}${typeAttribute}
        class="${joinClassNames(controlClass, 'folder-tree-template__leaf-control', active && 'is-active')}"
        ${renderAttributes(controlAttributes)}
      >${contentHtml}</${safeControlTag}>
    </div>
  `;
}

// Hover card for rail rows, appended to <body> so the scrolling rail cannot
// clip it. getText gets the row and, when the rail width has cut its label
// off, the label's full text ('' otherwise); an empty result shows nothing.
// Returns hide(), for callers to run before re-rendering the list.
export function attachRailHoverCard(listEl, {
  rowSelector,
  labelSelector = '.folder-tree-template__leaf-label, .folder-tree-template__label',
  getText = (row, clippedLabel) => clippedLabel
} = {}) {
  const doc = listEl?.ownerDocument;
  if (!doc || !rowSelector) {
    return () => {};
  }
  let card, hideTimer;
  function hide() { clearTimeout(hideTimer); if (card) card.hidden = true; }
  function show(event) {
    const row = event.target?.closest?.(rowSelector);
    if (!row || !listEl.contains(row)) return;
    const label = row.querySelector(labelSelector);
    const text = getText(row, label && label.scrollWidth > label.clientWidth ? label.textContent : '');
    if (!text) return;
    clearTimeout(hideTimer);
    if (!card) {
      card = doc.createElement('div');
      card.className = 'folder-tree-template__hover-card';
      card.setAttribute('role', 'tooltip');
      card.addEventListener('mouseleave', hide);
      card.addEventListener('mouseenter', () => clearTimeout(hideTimer));
      doc.body.append(card);
    }
    card.textContent = text;
    card.hidden = false;
    const bounds = row.getBoundingClientRect();
    const view = doc.defaultView;
    const gap = 8;
    const box = card.getBoundingClientRect();
    card.style.left = `${Math.max(gap, Math.min(bounds.right + gap, view.innerWidth - box.width - gap))}px`;
    card.style.top = `${Math.max(gap, Math.min(bounds.top, view.innerHeight - box.height - gap))}px`;
  }
  listEl.addEventListener('mouseover', show);
  listEl.addEventListener('focusin', show);
  listEl.addEventListener('mouseout', event => {
    if (!card?.contains(event.relatedTarget) && !event.target?.closest?.(rowSelector)?.contains(event.relatedTarget)) hideTimer = setTimeout(hide, 150);
  });
  listEl.addEventListener('focusout', hide);
  listEl.addEventListener('scroll', hide);
  listEl.addEventListener('dragstart', hide);
  doc.addEventListener('keydown', event => { if (event.key === 'Escape') hide(); });
  return hide;
}

export function getFolderTreeToggleKey(event) {
  const direct = normalizeFolderTreeKey(event?.target?.dataset?.folderTreeToggle);
  if (direct) {
    return direct;
  }
  return normalizeFolderTreeKey(
    event?.target?.closest?.('[data-folder-tree-toggle]')?.dataset?.folderTreeToggle
  );
}

// VS Code-style inline rename: hide the row control, drop a text input in its
// place, commit on Enter or blur, cancel on Escape. Callers re-render in
// onCommit; the control is restored first so a caller that does not still ends
// up with a sane row.
export function startInlineRename(target, {
  value = '',
  maxLength = 220,
  label = 'Rename',
  onCommit
} = {}) {
  const doc = target?.ownerDocument;
  const parent = target?.parentNode;
  if (typeof doc?.createElement !== 'function' || typeof parent?.insertBefore !== 'function') {
    return null;
  }

  const input = doc.createElement('input');
  input.type = 'text';
  input.className = 'folder-tree-template__rename-input';
  input.value = String(value || '');
  input.maxLength = maxLength;
  input.setAttribute('data-folder-tree-rename-input', '');
  input.setAttribute('aria-label', label);

  const previousDisplay = target.style ? target.style.display : '';
  if (target.style) {
    target.style.display = 'none';
  }
  parent.insertBefore(input, target);

  let settled = false;
  function finish(commit) {
    if (settled) {
      return;
    }
    settled = true;
    const nextName = String(input.value || '');
    input.remove?.();
    if (target.style) {
      target.style.display = previousDisplay || '';
    }
    if (commit) {
      onCommit?.(nextName);
    }
  }

  input.addEventListener('keydown', (event) => {
    const key = String(event?.key || '');
    if (key !== 'Enter' && key !== 'Escape') {
      return;
    }
    event.preventDefault?.();
    event.stopPropagation?.();
    finish(key === 'Enter');
  });
  input.addEventListener('blur', () => finish(true));
  ['click', 'dblclick', 'contextmenu'].forEach((type) => {
    input.addEventListener(type, (event) => event?.stopPropagation?.());
  });

  input.focus?.();
  input.select?.();
  return input;
}
