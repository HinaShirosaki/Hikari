import { runInsightAction } from './controller-actions.js';
import {
  bindGlobalSelectionInsightEvents,
  bindHostListeners
} from './controller-events.js';
import { refreshHost } from './controller-selection.js';
import {
  hideMenu,
  hidePanel,
  refreshPanel
} from './controller-ui.js';
import { cleanText } from './text-utils.js';

export function createSelectionInsightsController({
  state,
  persist,
  createId,
  safeText,
  rootDocument = globalThis.document || null,
  windowObject = globalThis.window || null,
  api = windowObject?.enanaApi || globalThis.enanaApi || null
} = {}) {
  const ctx = {
    state,
    persist,
    createId,
    safeText,
    rootDocument,
    windowObject,
    api,
    hosts: new Map(),
    menuNode: null,
    panelNode: null,
    activeMenuState: null,
    activePanelState: null,
    hidePanelTimer: 0,
    runInsightAction: null
  };

  ctx.runInsightAction = (hostKey, selectionContext, actionType) => (
    runInsightAction(ctx, hostKey, selectionContext, actionType)
  );

  bindGlobalSelectionInsightEvents(ctx);
  ctx.windowObject?.addEventListener?.('resize', () => {
    hideMenu(ctx);
    refreshPanel(ctx);
  });

  return {
    registerHost({ key, host, getContext }) {
      const hostKey = cleanText(key, 120);
      if (!hostKey || !host || typeof getContext !== 'function') {
        return;
      }
      ctx.hosts.set(hostKey, { key: hostKey, host, getContext });
      bindHostListeners(ctx, hostKey, host);
    },
    refreshHost: (hostKey) => refreshHost(ctx, hostKey),
    hideMenu: () => hideMenu(ctx),
    hidePanel: () => hidePanel(ctx)
  };
}
