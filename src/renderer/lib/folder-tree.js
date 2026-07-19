function normalizeFolderTreeKey(value) {
  return String(value || '').trim();
}

export function createFolderTreeState({ defaultExpanded = true } = {}) {
  const expandedKeys = new Set();
  const collapsedKeys = new Set();

  function isExpanded(rawKey, hasChildren = true) {
    const key = normalizeFolderTreeKey(rawKey);
    if (!key || !hasChildren) {
      return false;
    }
    return defaultExpanded ? !collapsedKeys.has(key) : expandedKeys.has(key);
  }

  function setExpanded(rawKey, expanded = true) {
    const key = normalizeFolderTreeKey(rawKey);
    if (!key) {
      return false;
    }
    if (defaultExpanded) {
      if (expanded) {
        collapsedKeys.delete(key);
      } else {
        collapsedKeys.add(key);
      }
    } else if (expanded) {
      expandedKeys.add(key);
    } else {
      expandedKeys.delete(key);
    }
    return expanded;
  }

  function toggle(rawKey, hasChildren = true) {
    const nextExpanded = !isExpanded(rawKey, hasChildren);
    return setExpanded(rawKey, nextExpanded);
  }

  function reveal(rawKeys = []) {
    rawKeys.forEach((key) => setExpanded(key, true));
  }

  return {
    isExpanded,
    setExpanded,
    toggle,
    reveal
  };
}
