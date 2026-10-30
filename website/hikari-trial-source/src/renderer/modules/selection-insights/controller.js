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

// Selection insights: select text on a notebook page or protocol, pick "What is
// it?" or "Where to buy?", and a one-shot LLM answer is saved against that
// exact selection and shown as a highlight with a hover panel.
// A host registers { key, host, getContext }; getContext returns the record
// being viewed plus updateRecord/ensureRecord hooks so this module never
// reaches into notebook or protocol state directly. Elements marked with
// data-selection-segment-id are the selectable segments.
export function createSelectionInsightsController({
  state,
  persist,
  createId,
  safeText,
  rootDocument = globalThis.document || null,
  windowObject = globalThis.window || null,
  api = windowObject?.hikariApi || globalThis.hikariApi || null
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
