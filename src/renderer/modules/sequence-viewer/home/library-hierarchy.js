// Search retains a matching fragment's ancestry, and a matching template shows
// its descendants. Entries whose parent is outside the current status filter
// remain accessible as roots.
export function buildDnaLibraryHierarchy(entries = [], query = '') {
  const byId = new Map(entries.map(entry => [entry.id, entry]));
  const parentIds = new Map();
  for (const entry of entries) {
    let parentId = byId.has(entry.parentEntryId) ? entry.parentEntryId : '';
    const visited = new Set([entry.id]);
    let ancestor = parentId;
    while (ancestor) {
      if (visited.has(ancestor)) { parentId = ''; break; }
      visited.add(ancestor);
      ancestor = byId.get(ancestor)?.parentEntryId;
    }
    parentIds.set(entry.id, parentId);
  }
  const children = new Map();
  for (const entry of entries) {
    const parentId = parentIds.get(entry.id);
    if (!children.has(parentId)) children.set(parentId, []);
    children.get(parentId).push(entry);
  }
  const visibleIds = new Set();
  const expandedSubtrees = new Set();
  const includeDescendants = entry => {
    if (expandedSubtrees.has(entry.id)) return;
    expandedSubtrees.add(entry.id);
    visibleIds.add(entry.id);
    (children.get(entry.id) || []).forEach(includeDescendants);
  };
  for (const entry of entries) {
    if (!query || String(entry.name || '').toLowerCase().includes(query)) {
      includeDescendants(entry);
      let parentId = parentIds.get(entry.id);
      while (parentId) {
        visibleIds.add(parentId);
        parentId = parentIds.get(parentId);
      }
    }
  }
  return { byId, parentIds, children, roots: children.get('') || [], visibleIds };
}
