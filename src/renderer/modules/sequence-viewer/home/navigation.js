// Switching the Sequence Viewer between its home page and the detail workspace,
// and the saved / temporary filter the library list is showing.
function createHomeNavigation({
  rootDocument,
  elements,
  state,
  libraryStatusSaved,
  libraryStatusTemporary,
  hideFeatureContextMenu,
  hideFeatureEditor,
  onNavigateHome,
  onNavigateDetail,
  getLibrarySavedFilterButtons,
  getLibraryTemporaryFilterButtons
} = {}) {
  function setLocalWorkspaceVisibility(mode) {
    const next = mode === 'detail'
      ? 'detail'
      : mode === 'alignment'
        ? 'alignment'
        : mode === 'builder'
          ? 'builder'
          : mode === 'cloning'
            ? 'cloning'
            : mode === 'vector'
              ? 'vector'
              : 'home';
    const previous = state.localWorkspaceMode;
    state.localWorkspaceMode = next;
    rootDocument?.body?.classList?.toggle?.('sequence-viewer-fixed-scroll', next === 'builder' || next === 'alignment');
    if (elements.homeWorkspace) {
      elements.homeWorkspace.hidden = next !== 'home';
    }
    if (elements.proteinBuilderWorkspace) {
      elements.proteinBuilderWorkspace.hidden = next !== 'builder';
    }
    if (elements.detailWorkspace) {
      elements.detailWorkspace.hidden = next !== 'detail' && next !== 'alignment';
    }
    if (elements.cloningDesignWorkspace) {
      elements.cloningDesignWorkspace.hidden = next !== 'cloning';
    }
    if (elements.vectorBuilderWorkspace) {
      elements.vectorBuilderWorkspace.hidden = next !== 'vector';
    }
    if (elements.alignmentWorkspace) {
      elements.alignmentWorkspace.hidden = next !== 'alignment';
    }
    if (previous !== next && (next === 'home' || next === 'detail')) {
      const list = next === 'home' ? elements.libraryList : elements.detailLibraryList;
      const scroll = list?.closest?.('.left-rail-template__scroll');
      // The shell makes the destination view visible after this local switch.
      rootDocument?.defaultView?.requestAnimationFrame?.(() => {
        if (state.localWorkspaceMode === next && scroll) {
          scroll.scrollTop = state.libraryScrollTop || 0;
        }
      });
    }
  }

  function navigateToHome() {
    hideFeatureContextMenu();
    hideFeatureEditor();
    setLocalWorkspaceVisibility('home');
    if (onNavigateHome) {
      onNavigateHome();
    }
  }

  function navigateToDetail() {
    hideFeatureContextMenu();
    hideFeatureEditor();
    setLocalWorkspaceVisibility('detail');
    if (onNavigateDetail) {
      onNavigateDetail();
    }
  }

  function setLibraryFilter(status) {
    state.libraryFilter = status === libraryStatusTemporary ? libraryStatusTemporary : libraryStatusSaved;
    getLibrarySavedFilterButtons().forEach((button) => {
      button.classList.toggle(
        'sequence-viewer-library-switch-btn-active',
        state.libraryFilter === libraryStatusSaved
      );
    });
    getLibraryTemporaryFilterButtons().forEach((button) => {
      button.classList.toggle(
        'sequence-viewer-library-switch-btn-active',
        state.libraryFilter === libraryStatusTemporary
      );
    });
  }

  return {
    setLocalWorkspaceVisibility,
    navigateToHome,
    navigateToDetail,
    setLibraryFilter
  };
}

export { createHomeNavigation };
