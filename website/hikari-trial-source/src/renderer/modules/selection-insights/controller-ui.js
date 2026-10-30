import { ACTION_WHAT_IS_IT, ACTION_WHERE_TO_BUY } from './constants.js';
import { getCurrentContext, getHostRegistration } from './controller-context.js';
import { buildPanelHtml } from './panel-rendering.js';
import { setFixedPosition } from './selection-dom.js';
import { cleanText, clamp, normalizeActionLabel } from './text-utils.js';

export function ensureUi(ctx) {
  if (!ctx.rootDocument?.body) {
    return;
  }
  if (!ctx.menuNode) {
    ctx.menuNode = ctx.rootDocument.createElement('div');
    ctx.menuNode.className = 'selection-insight-menu';
    ctx.menuNode.hidden = true;
    ctx.menuNode.innerHTML = `
      <button type="button" class="selection-insight-menu-item hikari-agent-action" data-selection-insight-action="${ACTION_WHAT_IS_IT}">
        <span class="selection-insight-menu-copy">
          <span class="selection-insight-menu-label">${normalizeActionLabel(ACTION_WHAT_IS_IT)}</span>
          <span class="selection-insight-menu-description">Understand its meaning and role</span>
        </span>
      </button>
      <button type="button" class="selection-insight-menu-item hikari-agent-action" data-selection-insight-action="${ACTION_WHERE_TO_BUY}">
        <span class="selection-insight-menu-copy">
          <span class="selection-insight-menu-label">${normalizeActionLabel(ACTION_WHERE_TO_BUY)}</span>
          <span class="selection-insight-menu-description">Explore products and where to buy</span>
        </span>
      </button>
    `;
    ctx.rootDocument.body.appendChild(ctx.menuNode);
    ctx.menuNode.addEventListener('click', (event) => {
      const actionButton = event.target?.closest?.('[data-selection-insight-action]');
      const actionType = cleanText(actionButton?.dataset?.selectionInsightAction, 80);
      if (!actionType || !ctx.activeMenuState) {
        return;
      }
      void ctx.runInsightAction(ctx.activeMenuState.hostKey, ctx.activeMenuState.selectionContext, actionType);
    });
  }
  if (!ctx.panelNode) {
    ctx.panelNode = ctx.rootDocument.createElement('aside');
    ctx.panelNode.className = 'selection-insight-panel';
    ctx.panelNode.hidden = true;
    ctx.panelNode.addEventListener('mouseenter', () => cancelHidePanel(ctx));
    ctx.panelNode.addEventListener('mouseleave', () => {
      if (!ctx.activePanelState?.pinned) {
        scheduleHidePanel(ctx);
      }
    });
    ctx.panelNode.addEventListener('click', async (event) => {
      const openUrlButton = event.target?.closest?.('[data-selection-insight-open-url]');
      const url = cleanText(openUrlButton?.dataset?.selectionInsightOpenUrl, 2000);
      if (!url || !ctx.api?.openExternalUrl) {
        return;
      }
      await ctx.api.openExternalUrl(url);
    });
    ctx.rootDocument.body.appendChild(ctx.panelNode);
  }
}

export function hideMenu(ctx) {
  ctx.activeMenuState = null;
  if (ctx.menuNode) {
    ctx.menuNode.hidden = true;
  }
}

export function cancelHidePanel(ctx) {
  if (ctx.hidePanelTimer) {
    ctx.windowObject?.clearTimeout?.(ctx.hidePanelTimer);
    ctx.hidePanelTimer = 0;
  }
}

export function hidePanel(ctx) {
  cancelHidePanel(ctx);
  ctx.activePanelState = null;
  if (ctx.panelNode) {
    ctx.panelNode.hidden = true;
    ctx.panelNode.innerHTML = '';
  }
}

export function scheduleHidePanel(ctx) {
  cancelHidePanel(ctx);
  ctx.hidePanelTimer = ctx.windowObject?.setTimeout?.(() => {
    hidePanel(ctx);
  }, 140) || 0;
}

export function positionMenu(ctx, x, y) {
  if (!ctx.menuNode || !ctx.windowObject) {
    return;
  }
  ctx.menuNode.hidden = false;
  const rect = ctx.menuNode.getBoundingClientRect();
  const viewportWidth = ctx.windowObject.innerWidth || 0;
  const viewportHeight = ctx.windowObject.innerHeight || 0;
  const left = clamp(Math.round(x), 8, Math.max(8, viewportWidth - rect.width - 8));
  const top = clamp(Math.round(y), 8, Math.max(8, viewportHeight - rect.height - 8));
  ctx.menuNode.style.left = `${left}px`;
  ctx.menuNode.style.top = `${top}px`;
}

export function openPanelByInsightId(ctx, hostKey, insightId, options = {}) {
  ensureUi(ctx);
  const context = getCurrentContext(ctx, hostKey);
  const registration = getHostRegistration(ctx, hostKey);
  if (!context || !registration?.host || !ctx.panelNode) {
    hidePanel(ctx);
    return;
  }
  const insight = context.insights.find((item) => item.id === insightId) || null;
  if (!insight) {
    hidePanel(ctx);
    return;
  }
  const anchor = registration.host.querySelector(`[data-selection-insight-anchor-id="${insightId.replace(/"/g, '\\"')}"]`);
  ctx.panelNode.innerHTML = buildPanelHtml(insight);
  ctx.panelNode.hidden = false;
  const anchorRect = anchor?.getBoundingClientRect?.() || options.fallbackRect || null;
  if (anchorRect) {
    setFixedPosition(ctx.panelNode, anchorRect, ctx.windowObject);
  }
  ctx.activePanelState = {
    hostKey,
    insightId,
    pinned: options.pinned === true,
    fallbackRect: options.fallbackRect || null
  };
}

export function refreshPanel(ctx) {
  if (!ctx.activePanelState) {
    return;
  }
  openPanelByInsightId(ctx, ctx.activePanelState.hostKey, ctx.activePanelState.insightId, {
    pinned: ctx.activePanelState.pinned,
    fallbackRect: ctx.activePanelState.fallbackRect
  });
}
