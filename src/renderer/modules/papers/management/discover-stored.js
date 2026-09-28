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
    lastStoragePath: '',
    lastRunAt: 0
  };
  let currentRun = null;
  // Set when main reports a newly saved PDF: the next scan skips the throttle.
  let stale = false;

  // Callers that need the result (force: a file saved elsewhere since the last
  // scan) get the scan already in flight rather than a no-op.
  function maybeDiscoverStoredPapers({ force = false } = {}) {
    const storagePath = String(state.settings?.storagePath || '').trim();
    if (!storagePath || !elements.papersView?.classList?.contains?.('is-active')) {
      return Promise.resolve();
    }
    if (!windowRef?.hikariApi?.discoverStoredPapers) {
      return Promise.resolve();
    }
    if (currentRun) {
      return currentRun;
    }
    const now = Date.now();
    if (!force && !stale && discoveryState.lastStoragePath === storagePath && now - discoveryState.lastRunAt < 15_000) {
      return Promise.resolve();
    }
    stale = false;
    currentRun = discover(storagePath).finally(() => {
      currentRun = null;
      // A file saved while this scan ran may have been missed.
      if (stale) {
        void maybeDiscoverStoredPapers();
      }
    });
    return currentRun;
  }

  function markStale() {
    stale = true;
  }

  async function discover(storagePath) {
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
    // Both merges must run: `||` skipped new papers whenever a club was new.
    const clubsChanged = mergeDiscoveredJournalClubs(result.journalClubs);
    const papersChanged = mergeDiscoveredPapers(result.papers);
    if (clubsChanged || papersChanged) {
      persist();
      library.renderLinkTargets();
      library.renderLibrarySidebar();
      comments.renderCommentSidebar();
    }
  }

  return { maybeDiscoverStoredPapers, markStale };
}

export { createStoredPaperDiscovery };
