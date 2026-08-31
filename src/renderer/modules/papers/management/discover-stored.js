// One-shot scan of the storage root for papers that exist on disk but not in
// state. Runs when the Papers view becomes visible.
function createStoredPaperDiscovery({
  state,
  elements,
  windowRef,
  library,
  comments,
  mergeDiscoveredJournalClubs,
  mergeDiscoveredPapers,
  persist
} = {}) {
  const discoveryState = {
    inFlight: false,
    lastStoragePath: '',
    lastRunAt: 0
  };

  async function maybeDiscoverStoredPapers() {
    const storagePath = String(state.settings?.storagePath || '').trim();
    if (!storagePath || !elements.papersView?.classList?.contains?.('is-active')) {
      return;
    }
    if (!windowRef?.hikariApi?.discoverStoredPapers || discoveryState.inFlight) {
      return;
    }
    const now = Date.now();
    if (discoveryState.lastStoragePath === storagePath && now - discoveryState.lastRunAt < 15_000) {
      return;
    }

    discoveryState.inFlight = true;
    try {
      const result = await windowRef.hikariApi.discoverStoredPapers({
        storagePath,
        knownPapers: state.papers || [],
        projects: state.projects || [],
        journalClubs: state.journalClubs || []
      });
      discoveryState.lastStoragePath = storagePath;
      discoveryState.lastRunAt = Date.now();
      if (!result?.ok) {
        return;
      }
      const changed = mergeDiscoveredJournalClubs(result.journalClubs)
        || mergeDiscoveredPapers(result.papers);
      if (changed) {
        persist();
        library.renderLinkTargets();
        library.renderLibrarySidebar();
        comments.renderCommentSidebar();
      }
    } finally {
      discoveryState.inFlight = false;
    }
  }

  return { maybeDiscoverStoredPapers };
}

export { createStoredPaperDiscovery };
