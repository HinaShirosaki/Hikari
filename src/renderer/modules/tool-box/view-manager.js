export function initToolBoxViewManager(options = {}) {
  const rootDocument = options?.document || globalThis?.document || null;
  if (!rootDocument) {
    return { showToolView: () => {} };
  }

  const toolTiles = [...rootDocument.querySelectorAll('.tool-tile')];
  const toolSubviews = [...rootDocument.querySelectorAll('.tool-subview')];
  let colonyToolInitPromise = null;

  function ensureColonyToolInitialized() {
    if (colonyToolInitPromise) {
      return colonyToolInitPromise;
    }

    colonyToolInitPromise = import('./colony-counter.js')
      .then(({ initColonyCounterTool }) => {
        if (typeof initColonyCounterTool === 'function') {
          initColonyCounterTool();
        }
      })
      .catch((error) => {
        colonyToolInitPromise = null;
        console.error('Failed to initialize colony counter tool:', error);
        const colonyStatus = rootDocument.getElementById('colony-status');
        if (colonyStatus) {
          colonyStatus.textContent = 'Failed to load colony counter tool.';
          colonyStatus.style.color = 'var(--theme-danger)';
        }
      });

    return colonyToolInitPromise;
  }

  function showToolView(viewId) {
    toolSubviews.forEach((subview) => {
      subview.hidden = subview.id !== viewId;
    });

    toolTiles.forEach((tile) => {
      const isActive = tile.dataset.toolView === viewId;
      tile.classList.toggle('tool-tile-active', isActive);
      tile.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });

    if (viewId === 'tool-colony-counter-view') {
      void ensureColonyToolInitialized();
    }
  }

  toolTiles.forEach((tile) => {
    tile.addEventListener('click', () => {
      showToolView(tile.dataset.toolView);
    });
  });

  showToolView(options?.defaultViewId || 'tool-molarity-view');
  return { showToolView };
}
