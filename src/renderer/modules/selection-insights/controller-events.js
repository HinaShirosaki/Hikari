import { getSelectionContext } from './controller-selection.js';
import {
  ensureUi,
  hideMenu,
  hidePanel,
  openPanelByInsightId,
  positionMenu,
  refreshPanel,
  scheduleHidePanel,
  cancelHidePanel
} from './controller-ui.js';
import { cleanText, isElementNode } from './text-utils.js';

export function bindHostListeners(ctx, hostKey, host) {
  if (!host || host.dataset.selectionInsightsBound === 'true') {
    return;
  }
  host.dataset.selectionInsightsBound = 'true';

  host.addEventListener('contextmenu', (event) => {
    const selectionContext = getSelectionContext(ctx, hostKey);
    if (!selectionContext) {
      hideMenu(ctx);
      return;
    }
    ensureUi(ctx);
    event.preventDefault();
    ctx.activeMenuState = {
      hostKey,
      selectionContext
    };
    positionMenu(ctx, event.clientX, event.clientY);
  });

  host.addEventListener('pointerover', (event) => {
    const anchor = event.target?.closest?.('[data-selection-insight-anchor-id]');
    if (!anchor || !host.contains(anchor)) {
      return;
    }
    cancelHidePanel(ctx);
    openPanelByInsightId(ctx, hostKey, cleanText(anchor.dataset.selectionInsightAnchorId, 120), {
      pinned: false
    });
  });

  host.addEventListener('pointerout', (event) => {
    const anchor = event.target?.closest?.('[data-selection-insight-anchor-id]');
    if (!anchor || !host.contains(anchor)) {
      return;
    }
    const related = event.relatedTarget;
    if (isElementNode(related) && (anchor.contains(related) || ctx.panelNode?.contains?.(related))) {
      return;
    }
    if (!ctx.activePanelState?.pinned) {
      scheduleHidePanel(ctx);
    }
  });

  host.addEventListener('focusin', (event) => {
    const anchor = event.target?.closest?.('[data-selection-insight-anchor-id]');
    if (!anchor || !host.contains(anchor)) {
      return;
    }
    openPanelByInsightId(ctx, hostKey, cleanText(anchor.dataset.selectionInsightAnchorId, 120), {
      pinned: false
    });
  });

  host.addEventListener('focusout', (event) => {
    const anchor = event.target?.closest?.('[data-selection-insight-anchor-id]');
    if (!anchor || !host.contains(anchor)) {
      return;
    }
    const related = event.relatedTarget;
    if (isElementNode(related) && ctx.panelNode?.contains?.(related)) {
      return;
    }
    if (!ctx.activePanelState?.pinned) {
      scheduleHidePanel(ctx);
    }
  });
}

export function bindGlobalSelectionInsightEvents(ctx) {
  if (!ctx.rootDocument) {
    return;
  }
  ensureUi(ctx);
  ctx.rootDocument.addEventListener('click', (event) => {
    const target = event.target;
    if (!isElementNode(target)) {
      hideMenu(ctx);
      if (ctx.activePanelState?.pinned) {
        hidePanel(ctx);
      }
      return;
    }
    if (!ctx.menuNode?.contains(target)) {
      hideMenu(ctx);
    }
    if (ctx.panelNode?.contains(target)) {
      return;
    }
    if (target.closest('[data-selection-insight-anchor-id]')) {
      return;
    }
    if (ctx.activePanelState) {
      hidePanel(ctx);
    }
  });
  ctx.rootDocument.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      hideMenu(ctx);
      hidePanel(ctx);
    }
  });
  ctx.rootDocument.addEventListener('scroll', () => {
    if (ctx.activeMenuState) {
      hideMenu(ctx);
    }
    refreshPanel(ctx);
  }, true);
}
