// Folds papers and journal clubs discovered on disk into the in-memory state,
// reporting whether anything actually changed so the caller can skip a persist.
function createDiscoveryMerge({ state } = {}) {
  function mergeDiscoveredJournalClubs(discoveredClubs = []) {
    let changed = false;
    if (!Array.isArray(state.journalClubs)) {
      state.journalClubs = [];
      changed = true;
    }
    const existingById = new Map((state.journalClubs || []).map((club) => [String(club?.id || '').trim(), club]));
    discoveredClubs.forEach((club) => {
      const normalized = club && typeof club === 'object' ? club : {};
      const id = String(normalized.id || '').trim();
      if (!id) {
        return;
      }
      const existing = existingById.get(id);
      if (existing) {
        return;
      }
      state.journalClubs.push({
        id,
        name: String(normalized.name || 'Discovered folder').trim() || 'Discovered folder',
        description: String(normalized.description || '').trim()
      });
      changed = true;
    });
    return changed;
  }

  function mergeDiscoveredPapers(discoveredPapers = []) {
    let changed = false;
    if (!Array.isArray(state.papers)) {
      state.papers = [];
      changed = true;
    }
    const existingByRelativePath = new Map(
      (state.papers || []).map((paper) => [
        String(paper?.storedRelativePath || '').trim().toLowerCase(),
        paper
      ]).filter(([key]) => key)
    );
    discoveredPapers.forEach((paper) => {
      const normalized = paper && typeof paper === 'object' ? paper : {};
      const relativePath = String(normalized.storedRelativePath || '').trim();
      const lowerRelativePath = relativePath.toLowerCase();
      if (!lowerRelativePath) {
        return;
      }
      const existing = existingByRelativePath.get(lowerRelativePath);
      if (existing) {
        const merged = {
          ...existing,
          ...normalized,
          id: existing.id || normalized.id
        };
        const previousJson = JSON.stringify(existing);
        const nextJson = JSON.stringify(merged);
        if (previousJson !== nextJson) {
          Object.assign(existing, merged);
          changed = true;
        }
        return;
      }
      state.papers.push(normalized);
      existingByRelativePath.set(lowerRelativePath, normalized);
      changed = true;
    });
    return changed;
  }

  return { mergeDiscoveredJournalClubs, mergeDiscoveredPapers };
}

export { createDiscoveryMerge };
