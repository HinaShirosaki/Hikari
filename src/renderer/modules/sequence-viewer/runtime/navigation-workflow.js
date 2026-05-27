export function createNavigationActions(ctx) {
  const { actions, controllers, onNavigateHome, onNavigateDetail, homeViewId, detailViewId, state } = ctx;

  function showProteinBuilderWorkspace() {
    actions.setProteinBuilderConfirmation(null, { render: false });
    hideDetailOverlays();
    controllers.home?.setLocalWorkspaceVisibility('builder');
    onNavigateHome?.();
  }

  function showCloningDesignWorkspace() {
    hideDetailOverlays();
    controllers.home?.setLocalWorkspaceVisibility('cloning');
    onNavigateDetail?.();
  }

  function returnToSequenceDetailFromCloningDesign() {
    controllers.home?.setLocalWorkspaceVisibility('detail');
    onNavigateDetail?.();
    controllers.detail?.renderActiveRecord?.();
    actions.setStatus('Returned to Sequence Viewer.');
  }

  function returnToProteinBuilder() {
    actions.setProteinBuilderConfirmation(null, { render: false });
    showProteinBuilderWorkspace();
    actions.setStatus('Returned to Protein Builder to adjust the construct.');
  }

  function syncShellWorkspace(activeViewId = '') {
    const nextViewId = String(activeViewId || '').trim();
    const workspaceMode = String(state.localWorkspaceMode || '').trim().toLowerCase();
    if (!nextViewId || !workspaceMode) {
      return;
    }
    if (nextViewId === homeViewId) {
      if (workspaceMode === 'detail' || workspaceMode === 'alignment' || workspaceMode === 'cloning') {
        controllers.home?.setLocalWorkspaceVisibility('home');
      }
      return;
    }
    if (nextViewId === detailViewId && (workspaceMode === 'home' || workspaceMode === 'builder')) {
      controllers.home?.setLocalWorkspaceVisibility('detail');
    }
  }

  function render(renderOptions = {}) {
    syncShellWorkspace(renderOptions?.activeViewId);
    controllers.detail.updateRecordSelect();
    controllers.detail.renderActiveRecord();
    controllers.alignment?.render?.();
    controllers.cloningDesign?.render?.();
    controllers.proteinBuilder?.render();
    controllers.home.syncHomeControlsState();
    void controllers.home.refreshLibraryEntries({ silent: true });
  }

  async function openDroppedSequenceFile(file) {
    if (!file) {
      return;
    }
    try {
      actions.setStatus(`Reading ${file.name}...`);
      await controllers.home?.openSequenceFileInDetail?.(file);
    } catch (error) {
      actions.setStatus(String(error?.message || error || 'Failed to open dropped sequence file.'), true);
    }
  }

  function hideDetailOverlays() {
    controllers.detail?.hideFeatureContextMenu();
    controllers.detail?.hideFeatureEditor();
    controllers.detail?.hidePrimerDesignOverlay?.();
    controllers.detail?.hideSequenceEditDialog?.();
  }

  return {
    openDroppedSequenceFile,
    render,
    returnToSequenceDetailFromCloningDesign,
    returnToProteinBuilder,
    showCloningDesignWorkspace,
    showProteinBuilderWorkspace,
    syncShellWorkspace
  };
}
