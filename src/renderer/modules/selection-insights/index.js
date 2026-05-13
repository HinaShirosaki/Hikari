import { buildStateSnapshot } from '../agent-chat/state-snapshot.js';
import { normalizeAgentResponse } from '../agent-chat-response.js';

const ACTION_WHAT_IS_IT = 'what_is_it';
const ACTION_WHERE_TO_BUY = 'where_to_buy';
const INSIGHT_FILE_NAME = 'selection-insights.json';
const INSIGHT_SCHEMA_NAME = 'enana_selection_insights';
const INSIGHT_SCHEMA_VERSION = '1.0.0';
const TEXT_NODE = 3;

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function cleanText(value, maxLength = 4000) {
  const text = String(value || '').trim();
  if (!text) {
    return '';
  }
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength)}...`;
}

function cloneJson(value, fallback) {
  try {
    if (value == null) {
      return fallback;
    }
    return JSON.parse(JSON.stringify(value));
  } catch {
    return fallback;
  }
}

function sanitizeFolderName(value, fallback = 'item') {
  const cleaned = String(value || '')
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]+/g, '_')
    .replace(/\s+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 180);
  return cleaned || fallback;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function isElementNode(value) {
  const ElementCtor = globalThis.Element;
  return Boolean(ElementCtor && value instanceof ElementCtor);
}

function escapeAttribute(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;');
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatAnswerText(value) {
  return cleanText(value, 12000)
    .split(/\n{2,}/)
    .map((part) => cleanText(part, 4000))
    .filter(Boolean)
    .map((part) => `<p>${escapeHtml(part).replace(/\n/g, '<br />')}</p>`)
    .join('');
}

function normalizeActionLabel(actionType) {
  if (actionType === ACTION_WHERE_TO_BUY) {
    return 'Where to buy it';
  }
  return 'What is it';
}

function normalizeInsightAnswers(source) {
  const payload = source && typeof source === 'object' ? source : {};
  return {
    [ACTION_WHAT_IS_IT]: payload[ACTION_WHAT_IS_IT] && typeof payload[ACTION_WHAT_IS_IT] === 'object'
      ? cloneJson(payload[ACTION_WHAT_IS_IT], {})
      : null,
    [ACTION_WHERE_TO_BUY]: payload[ACTION_WHERE_TO_BUY] && typeof payload[ACTION_WHERE_TO_BUY] === 'object'
      ? cloneJson(payload[ACTION_WHERE_TO_BUY], {})
      : null
  };
}

function normalizeInsightRecord(rawInsight) {
  const source = rawInsight && typeof rawInsight === 'object' ? rawInsight : {};
  const id = cleanText(source.id, 120);
  const segmentId = cleanText(source.segmentId, 240);
  const selectedText = cleanText(source.selectedText, 500);
  if (!id || !segmentId || !selectedText) {
    return null;
  }
  return {
    id,
    segmentId,
    segmentLabel: cleanText(source.segmentLabel, 160),
    selectedText,
    occurrenceIndex: Math.max(1, Number(source.occurrenceIndex) || 1),
    contextText: cleanText(source.contextText, 4000),
    createdAt: cleanText(source.createdAt, 80),
    updatedAt: cleanText(source.updatedAt, 80),
    answers: normalizeInsightAnswers(source.answers)
  };
}

function normalizeInsights(insights) {
  return asArray(insights)
    .map((item) => normalizeInsightRecord(item))
    .filter(Boolean);
}

function shouldSkipTextNode(node) {
  if (!node || node.nodeType !== TEXT_NODE) {
    return true;
  }
  const parent = node.parentElement;
  if (!parent) {
    return true;
  }
  if (!String(node.textContent || '').length) {
    return true;
  }
  return Boolean(parent.closest('button, input, textarea, select, option'));
}

function collectSegmentTextEntries(segmentElement) {
  const entries = [];
  const walker = segmentElement?.ownerDocument?.createTreeWalker?.(
    segmentElement,
    globalThis.NodeFilter?.SHOW_TEXT ?? 4
  );
  if (!walker) {
    return entries;
  }
  let cursor = 0;
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (shouldSkipTextNode(node)) {
      continue;
    }
    const text = String(node.textContent || '');
    entries.push({
      node,
      text,
      start: cursor,
      end: cursor + text.length
    });
    cursor += text.length;
  }
  return entries;
}

function getSegmentPlainText(segmentElement) {
  return collectSegmentTextEntries(segmentElement)
    .map((entry) => entry.text)
    .join('');
}

function unwrapInsightAnchors(host) {
  host?.querySelectorAll?.('[data-selection-insight-anchor-id]')?.forEach?.((anchor) => {
    const parent = anchor.parentNode;
    if (!parent) {
      return;
    }
    while (anchor.firstChild) {
      parent.insertBefore(anchor.firstChild, anchor);
    }
    parent.removeChild(anchor);
  });
}

function locateOffsetInEntries(entries, absoluteOffset) {
  const normalizedOffset = Math.max(0, absoluteOffset);
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (normalizedOffset <= entry.end || index === entries.length - 1) {
      return {
        node: entry.node,
        offset: clamp(normalizedOffset - entry.start, 0, entry.text.length)
      };
    }
  }
  return null;
}

function findOccurrenceStart(segmentText, selectedText, occurrenceIndex = 1) {
  let currentOccurrence = 0;
  let searchIndex = 0;
  while (searchIndex <= segmentText.length) {
    const foundIndex = segmentText.indexOf(selectedText, searchIndex);
    if (foundIndex < 0) {
      return -1;
    }
    currentOccurrence += 1;
    if (currentOccurrence === Math.max(1, Number(occurrenceIndex) || 1)) {
      return foundIndex;
    }
    searchIndex = foundIndex + Math.max(1, selectedText.length);
  }
  return -1;
}

function wrapInsightOccurrence(segmentElement, insight) {
  if (!segmentElement || !insight) {
    return false;
  }
  const entries = collectSegmentTextEntries(segmentElement);
  const segmentText = entries.map((entry) => entry.text).join('');
  if (!segmentText || !entries.length) {
    return false;
  }
  const targetText = String(insight.selectedText || '');
  const startIndex = findOccurrenceStart(segmentText, targetText, insight.occurrenceIndex);
  if (startIndex < 0) {
    return false;
  }
  const endIndex = startIndex + targetText.length;
  const startPoint = locateOffsetInEntries(entries, startIndex);
  const endPoint = locateOffsetInEntries(entries, endIndex);
  if (!startPoint || !endPoint) {
    return false;
  }

  const range = segmentElement.ownerDocument.createRange();
  range.setStart(startPoint.node, startPoint.offset);
  range.setEnd(endPoint.node, endPoint.offset);
  if (range.collapsed) {
    return false;
  }

  const wrapper = segmentElement.ownerDocument.createElement('span');
  wrapper.className = 'selection-insight-anchor';
  wrapper.dataset.selectionInsightAnchorId = insight.id;
  wrapper.setAttribute('tabindex', '0');
  wrapper.setAttribute('role', 'button');
  wrapper.setAttribute('aria-label', `Open saved answer for ${cleanText(insight.selectedText, 200) || 'selected text'}`);

  const fragment = range.extractContents();
  wrapper.appendChild(fragment);
  range.insertNode(wrapper);
  return true;
}

function buildPanelPurchaseCards(answer) {
  const payload = answer?.payload && typeof answer.payload === 'object'
    ? answer.payload
    : {};
  const items = asArray(payload.items)
    .filter((item) => item && typeof item === 'object')
    .filter((item) => cleanText(item.title, 240) && cleanText(item.vendor, 180))
    .slice(0, 6);
  if (!items.length) {
    return '';
  }
  return `
    <section class="selection-insight-answer-block">
      <section class="agent-purchase-group" aria-label="Purchase recommendations">
        <div class="agent-purchase-grid">
          ${items.map((item) => {
            const url = cleanText(item.product_url, 2000);
            const imageUrl = cleanText(item.image_url, 2000);
            const itemContent = `
              ${imageUrl ? `
                <span class="agent-purchase-image-wrap">
                  <img
                    class="agent-purchase-image"
                    src="${escapeAttribute(imageUrl)}"
                    alt="${escapeAttribute(cleanText(item.title, 220))}"
                  />
                </span>
              ` : ''}
              <span class="agent-purchase-copy">
                <strong class="agent-purchase-title">${escapeHtml(cleanText(item.title, 220))}</strong>
                ${cleanText(item.price_text, 120) ? `<span class="agent-purchase-price">${escapeHtml(cleanText(item.price_text, 120))}</span>` : ''}
                <span class="agent-purchase-vendor">${escapeHtml(cleanText(item.vendor, 180))}</span>
              </span>
            `;
            if (url) {
              return `
                <button
                  type="button"
                  class="agent-purchase-item"
                  data-selection-insight-open-url="${escapeAttribute(url)}"
                  aria-label="${escapeAttribute(`Open ${cleanText(item.title, 220)} from ${cleanText(item.vendor, 180)}`)}"
                >
                  ${itemContent}
                </button>
              `;
            }
            return `
              <div class="agent-purchase-item selection-insight-purchase-static">
                ${itemContent}
              </div>
            `;
          }).join('')}
        </div>
      </section>
    </section>
  `;
}

function buildPanelHtml(insight) {
  if (!insight) {
    return `
      <div class="selection-insight-panel-empty">
        <p>No saved answer yet.</p>
      </div>
    `;
  }

  const whatIsIt = insight.answers?.[ACTION_WHAT_IS_IT];
  const whereToBuy = insight.answers?.[ACTION_WHERE_TO_BUY];
  const pendingAction = [whatIsIt, whereToBuy].find((answer) => cleanText(answer?.status, 40) === 'pending');
  const errorAction = [whatIsIt, whereToBuy].find((answer) => cleanText(answer?.status, 40) === 'error');

  return `
    <div class="selection-insight-panel-head">
      <span class="selection-insight-panel-kicker">Saved Answer</span>
      <h4>${escapeHtml(cleanText(insight.selectedText, 220) || 'Selected text')}</h4>
      ${cleanText(insight.segmentLabel, 120)
        ? `<p class="selection-insight-panel-meta">${escapeHtml(cleanText(insight.segmentLabel, 120))}</p>`
        : ''}
    </div>
    ${pendingAction ? `
      <div class="selection-insight-answer-block is-pending">
        <h5>${escapeHtml(normalizeActionLabel(pendingAction.actionType))}</h5>
        <p>Thinking about this selection...</p>
      </div>
    ` : ''}
    ${whatIsIt && cleanText(whatIsIt.status, 40) === 'completed' && cleanText(whatIsIt.text, 12000) ? `
      <section class="selection-insight-answer-block">
        <h5>${escapeHtml(normalizeActionLabel(ACTION_WHAT_IS_IT))}</h5>
        <div class="selection-insight-answer-copy">${formatAnswerText(whatIsIt.text)}</div>
      </section>
    ` : ''}
    ${whereToBuy && cleanText(whereToBuy.status, 40) === 'completed' && cleanText(whereToBuy.summary, 12000) ? `
      <section class="selection-insight-answer-block">
        <h5>${escapeHtml(normalizeActionLabel(ACTION_WHERE_TO_BUY))}</h5>
        <div class="selection-insight-answer-copy">${formatAnswerText(whereToBuy.summary)}</div>
      </section>
    ` : ''}
    ${whereToBuy && cleanText(whereToBuy.status, 40) === 'completed' ? buildPanelPurchaseCards(whereToBuy) : ''}
    ${errorAction && cleanText(errorAction.error, 1200) ? `
      <div class="selection-insight-answer-block is-error">
        <h5>${escapeHtml(normalizeActionLabel(errorAction.actionType))}</h5>
        <p>${escapeHtml(cleanText(errorAction.error, 1200))}</p>
      </div>
    ` : ''}
  `;
}

function createSelectionInsightPrompt({ actionType, selectedText, segmentText, context }) {
  const record = context?.record && typeof context.record === 'object' ? context.record : {};
  const recordName = cleanText(record?.name || record?.protocolName || context?.label, 220);
  const projectName = cleanText(record?.projectName || context?.projectName, 220);
  const segmentLabel = cleanText(context?.segmentLabel || '', 120);
  const heading = actionType === ACTION_WHERE_TO_BUY
    ? 'Help me figure out where to buy this selected lab item.'
    : 'Help me explain this selected lab term in context.';

  const instruction = actionType === ACTION_WHERE_TO_BUY
    ? 'Recommend where to buy the selected item for lab use. Prefer specific products or vendors when you can identify them.'
    : 'Answer the question "what is it?" for the selected text in this exact protocol or notebook context. Keep it concise and practical.';

  return [
    heading,
    instruction,
    recordName ? `Record: ${recordName}` : '',
    projectName ? `Project: ${projectName}` : '',
    segmentLabel ? `Section: ${segmentLabel}` : '',
    `Selected text: "${selectedText}"`,
    segmentText ? `Local context: "${cleanText(segmentText, 2400)}"` : ''
  ].filter(Boolean).join('\n\n');
}

function buildPendingAnswer(actionType, nowIso) {
  return {
    actionType,
    status: 'pending',
    requestedAt: nowIso,
    answeredAt: '',
    text: '',
    summary: '',
    payload: null,
    error: ''
  };
}

function buildCompletedAnswer(actionType, response) {
  if (actionType === ACTION_WHERE_TO_BUY) {
    return {
      actionType,
      status: 'completed',
      requestedAt: '',
      answeredAt: new Date().toISOString(),
      text: '',
      summary: cleanText(
        response?.purchaseRecommendation?.summary
          || (response?.purchaseRecommendation?.query
            ? response.assistantText
            : response?.assistantText),
        12000
      ),
      payload: cloneJson(response?.purchaseRecommendation, null),
      error: ''
    };
  }
  return {
    actionType,
    status: 'completed',
    requestedAt: '',
    answeredAt: new Date().toISOString(),
    text: cleanText(response?.assistantText, 12000),
    summary: '',
    payload: cloneJson(
      response?.generalScienceQuestion
        || response?.projectScienceQuestion
        || response?.resultAnalysis,
      null
    ),
    error: ''
  };
}

function buildErroredAnswer(actionType, errorMessage, pendingAnswer = null) {
  return {
    actionType,
    status: 'error',
    requestedAt: cleanText(pendingAnswer?.requestedAt, 80),
    answeredAt: new Date().toISOString(),
    text: '',
    summary: '',
    payload: null,
    error: cleanText(errorMessage, 1200) || 'The answer could not be generated.'
  };
}

function updateInsightAnswers(insights, selectionContext, actionType, answerUpdater, createId) {
  const nextInsights = normalizeInsights(insights);
  const existingInsight = selectionContext?.existingInsightId
    ? nextInsights.find((item) => item.id === selectionContext.existingInsightId)
    : nextInsights.find((item) => (
      item.segmentId === selectionContext.segmentId
      && item.selectedText === selectionContext.selectedText
      && Math.max(1, Number(item.occurrenceIndex) || 1) === Math.max(1, Number(selectionContext.occurrenceIndex) || 1)
    ));

  const nowIso = new Date().toISOString();
  const nextInsight = existingInsight
    ? {
      ...existingInsight,
      segmentId: selectionContext.segmentId,
      segmentLabel: selectionContext.segmentLabel,
      selectedText: selectionContext.selectedText,
      occurrenceIndex: Math.max(1, Number(selectionContext.occurrenceIndex) || 1),
      contextText: selectionContext.segmentText,
      updatedAt: nowIso,
      answers: normalizeInsightAnswers(existingInsight.answers)
    }
    : {
      id: cleanText(createId?.(), 120) || `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      segmentId: selectionContext.segmentId,
      segmentLabel: selectionContext.segmentLabel,
      selectedText: selectionContext.selectedText,
      occurrenceIndex: Math.max(1, Number(selectionContext.occurrenceIndex) || 1),
      contextText: selectionContext.segmentText,
      createdAt: nowIso,
      updatedAt: nowIso,
      answers: normalizeInsightAnswers({})
    };

  const currentAnswer = nextInsight.answers?.[actionType] && typeof nextInsight.answers[actionType] === 'object'
    ? cloneJson(nextInsight.answers[actionType], {})
    : null;
  nextInsight.answers[actionType] = answerUpdater(currentAnswer);

  const existingIndex = nextInsights.findIndex((item) => item.id === nextInsight.id);
  if (existingIndex >= 0) {
    nextInsights[existingIndex] = nextInsight;
  } else {
    nextInsights.push(nextInsight);
  }

  return {
    insights: nextInsights,
    insight: nextInsight
  };
}

function resolveNotebookStorageFolder(storagePath, record) {
  const configuredStoragePath = cleanText(storagePath, 2400);
  if (!configuredStoragePath) {
    return '';
  }
  const explicitStorageFolder = cleanText(record?.storageFolder, 2400);
  if (explicitStorageFolder) {
    return explicitStorageFolder;
  }
  const projectFolder = sanitizeFolderName(record?.projectName || 'Untitled_Project', 'Untitled_Project');
  const pageFolder = `${sanitizeFolderName(
    record?.protocolName || record?.id || 'Notebook_Page',
    'Notebook_Page'
  )}__${sanitizeFolderName(record?.id, 'page')}`;
  return `${configuredStoragePath}/Project/${projectFolder}/Notebook/${pageFolder}`;
}

function resolveProtocolStorageFolder(storagePath, record) {
  const configuredStoragePath = cleanText(storagePath, 2400);
  if (!configuredStoragePath) {
    return '';
  }
  const folderName = `${sanitizeFolderName(record?.name || 'Protocol', 'Protocol')}__${sanitizeFolderName(record?.id, 'protocol')}`;
  return `${configuredStoragePath}/Protocol/${folderName}`;
}

function resolveInsightStorageFolder(context) {
  const record = context?.record && typeof context.record === 'object' ? context.record : {};
  const storagePath = cleanText(context?.storagePath, 2400);
  if (!storagePath) {
    return '';
  }
  if (context?.kind === 'notebook') {
    return resolveNotebookStorageFolder(storagePath, record);
  }
  if (context?.kind === 'protocol') {
    return resolveProtocolStorageFolder(storagePath, record);
  }
  return '';
}

async function persistInsightSidecar({ api, context, insights }) {
  if (!api?.writeJsonFile) {
    return;
  }
  const storagePath = cleanText(context?.storagePath, 2400);
  const targetFolder = resolveInsightStorageFolder(context);
  if (!storagePath || !targetFolder) {
    return;
  }
  const record = context?.record && typeof context.record === 'object' ? context.record : {};
  try {
    await api.writeJsonFile({
      storagePath,
      targetFolder,
      fileName: INSIGHT_FILE_NAME,
      data: {
        schema_name: INSIGHT_SCHEMA_NAME,
        schema_version: INSIGHT_SCHEMA_VERSION,
        updated_at: new Date().toISOString(),
        owner: {
          kind: cleanText(context?.kind, 40),
          id: cleanText(record?.id, 120),
          name: cleanText(record?.name || record?.protocolName, 220)
        },
        insights: normalizeInsights(insights)
      }
    });
  } catch {
    // Sidecar sync is best-effort because state persistence already preserves answers.
  }
}

function setFixedPosition(node, rect, windowObject) {
  if (!node || !rect || !windowObject) {
    return;
  }
  const viewportWidth = windowObject.innerWidth || 0;
  const viewportHeight = windowObject.innerHeight || 0;
  const panelRect = node.getBoundingClientRect();
  const preferredLeft = rect.left;
  const preferredTop = rect.bottom + 10;
  const maxLeft = Math.max(8, viewportWidth - panelRect.width - 8);
  const maxTop = Math.max(8, viewportHeight - panelRect.height - 8);
  const top = preferredTop + panelRect.height > viewportHeight - 8
    ? Math.max(8, rect.top - panelRect.height - 10)
    : preferredTop;
  node.style.left = `${clamp(Math.round(preferredLeft), 8, maxLeft)}px`;
  node.style.top = `${clamp(Math.round(top), 8, maxTop)}px`;
}

export function createSelectionInsightsController({
  state,
  persist,
  createId,
  safeText,
  rootDocument = globalThis.document || null,
  windowObject = globalThis.window || null,
  api = windowObject?.enanaApi || globalThis.enanaApi || null
} = {}) {
  const hosts = new Map();
  let menuNode = null;
  let panelNode = null;
  let activeMenuState = null;
  let activePanelState = null;
  let hidePanelTimer = 0;

  function ensureUi() {
    if (!rootDocument?.body) {
      return;
    }
    if (!menuNode) {
      menuNode = rootDocument.createElement('div');
      menuNode.className = 'selection-insight-menu';
      menuNode.hidden = true;
      menuNode.innerHTML = `
        <button type="button" class="selection-insight-menu-item" data-selection-insight-action="${ACTION_WHAT_IS_IT}">What is it</button>
        <button type="button" class="selection-insight-menu-item" data-selection-insight-action="${ACTION_WHERE_TO_BUY}">Where to buy it</button>
      `;
      rootDocument.body.appendChild(menuNode);
      menuNode.addEventListener('click', (event) => {
        const actionButton = event.target?.closest?.('[data-selection-insight-action]');
        const actionType = cleanText(actionButton?.dataset?.selectionInsightAction, 80);
        if (!actionType || !activeMenuState) {
          return;
        }
        void runInsightAction(activeMenuState.hostKey, activeMenuState.selectionContext, actionType);
      });
    }
    if (!panelNode) {
      panelNode = rootDocument.createElement('aside');
      panelNode.className = 'selection-insight-panel';
      panelNode.hidden = true;
      panelNode.addEventListener('mouseenter', cancelHidePanel);
      panelNode.addEventListener('mouseleave', () => {
        if (!activePanelState?.pinned) {
          scheduleHidePanel();
        }
      });
      panelNode.addEventListener('click', async (event) => {
        const openUrlButton = event.target?.closest?.('[data-selection-insight-open-url]');
        const url = cleanText(openUrlButton?.dataset?.selectionInsightOpenUrl, 2000);
        if (!url || !api?.openExternalUrl) {
          return;
        }
        await api.openExternalUrl(url);
      });
      rootDocument.body.appendChild(panelNode);
    }
  }

  function getHostRegistration(hostKey) {
    return hosts.get(hostKey) || null;
  }

  function getCurrentContext(hostKey) {
    const registration = getHostRegistration(hostKey);
    if (!registration || typeof registration.getContext !== 'function') {
      return null;
    }
    const context = registration.getContext();
    if (!context || typeof context !== 'object') {
      return null;
    }
    const record = context.record && typeof context.record === 'object' ? context.record : null;
    if (!record) {
      return null;
    }
    return {
      ...context,
      record,
      label: cleanText(context.label || record.name || record.protocolName, 220),
      insights: normalizeInsights(context.insights || record.selectionInsights)
    };
  }

  function hideMenu() {
    activeMenuState = null;
    if (menuNode) {
      menuNode.hidden = true;
    }
  }

  function cancelHidePanel() {
    if (hidePanelTimer) {
      windowObject?.clearTimeout?.(hidePanelTimer);
      hidePanelTimer = 0;
    }
  }

  function hidePanel() {
    cancelHidePanel();
    activePanelState = null;
    if (panelNode) {
      panelNode.hidden = true;
      panelNode.innerHTML = '';
    }
  }

  function scheduleHidePanel() {
    cancelHidePanel();
    hidePanelTimer = windowObject?.setTimeout?.(() => {
      hidePanel();
    }, 140) || 0;
  }

  function positionMenu(x, y) {
    if (!menuNode || !windowObject) {
      return;
    }
    menuNode.hidden = false;
    const rect = menuNode.getBoundingClientRect();
    const viewportWidth = windowObject.innerWidth || 0;
    const viewportHeight = windowObject.innerHeight || 0;
    const left = clamp(Math.round(x), 8, Math.max(8, viewportWidth - rect.width - 8));
    const top = clamp(Math.round(y), 8, Math.max(8, viewportHeight - rect.height - 8));
    menuNode.style.left = `${left}px`;
    menuNode.style.top = `${top}px`;
  }

  function getSelectionContext(hostKey) {
    const registration = getHostRegistration(hostKey);
    const host = registration?.host || null;
    if (!host || !windowObject?.getSelection) {
      return null;
    }
    const selection = windowObject.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      return null;
    }
    const range = selection.getRangeAt(0);
    if (!range || range.collapsed) {
      return null;
    }
    if (range.startContainer?.nodeType !== TEXT_NODE || range.endContainer?.nodeType !== TEXT_NODE) {
      return null;
    }
    if (!host.contains(range.startContainer) || !host.contains(range.endContainer)) {
      return null;
    }

    const startElement = range.startContainer.parentElement;
    const endElement = range.endContainer.parentElement;
    if (!startElement || !endElement) {
      return null;
    }
    if (startElement.closest('button, input, textarea, select') || endElement.closest('button, input, textarea, select')) {
      return null;
    }

    const startSegment = startElement.closest('[data-selection-segment-id]');
    const endSegment = endElement.closest('[data-selection-segment-id]');
    if (!startSegment || !endSegment || startSegment !== endSegment) {
      return null;
    }

    const segmentEntries = collectSegmentTextEntries(startSegment);
    const segmentText = segmentEntries.map((entry) => entry.text).join('');
    const startEntry = segmentEntries.find((entry) => entry.node === range.startContainer);
    const endEntry = segmentEntries.find((entry) => entry.node === range.endContainer);
    if (!startEntry || !endEntry) {
      return null;
    }
    const startOffset = startEntry.start + clamp(range.startOffset, 0, startEntry.text.length);
    const endOffset = endEntry.start + clamp(range.endOffset, 0, endEntry.text.length);
    if (endOffset <= startOffset) {
      return null;
    }

    const selectedText = cleanText(range.toString(), 500);
    if (!selectedText) {
      return null;
    }

    const beforeSelection = segmentText.slice(0, startOffset);
    let occurrenceIndex = 1;
    let searchIndex = 0;
    while (searchIndex <= beforeSelection.length) {
      const foundIndex = beforeSelection.indexOf(selectedText, searchIndex);
      if (foundIndex < 0) {
        break;
      }
      occurrenceIndex += 1;
      searchIndex = foundIndex + Math.max(1, selectedText.length);
    }

    const existingAnchor = startElement.closest('[data-selection-insight-anchor-id]')
      || endElement.closest('[data-selection-insight-anchor-id]');
    return {
      segmentId: cleanText(startSegment.dataset.selectionSegmentId, 240),
      segmentLabel: cleanText(startSegment.dataset.selectionSegmentLabel, 160),
      segmentText: cleanText(segmentText, 4000),
      selectedText,
      occurrenceIndex,
      existingInsightId: cleanText(existingAnchor?.dataset?.selectionInsightAnchorId, 120),
      selectionRect: range.getBoundingClientRect()
    };
  }

  function refreshHost(hostKey) {
    const registration = getHostRegistration(hostKey);
    const host = registration?.host || null;
    const context = getCurrentContext(hostKey);
    if (!host) {
      return;
    }

    if (!context) {
      unwrapInsightAnchors(host);
      if (activePanelState?.hostKey === hostKey) {
        hidePanel();
      }
      return;
    }

    unwrapInsightAnchors(host);

    if (!context.insights.length) {
      if (activePanelState?.hostKey === hostKey) {
        refreshPanel();
      }
      return;
    }

    const segmentMap = new Map();
    asArray(host.querySelectorAll('[data-selection-segment-id]')).forEach((segment) => {
      segmentMap.set(cleanText(segment.dataset.selectionSegmentId, 240), segment);
    });

    context.insights
      .slice()
      .sort((left, right) => {
        const lengthDiff = String(right?.selectedText || '').length - String(left?.selectedText || '').length;
        if (lengthDiff !== 0) {
          return lengthDiff;
        }
        return Math.max(1, Number(left?.occurrenceIndex) || 1) - Math.max(1, Number(right?.occurrenceIndex) || 1);
      })
      .forEach((insight) => {
        const segment = segmentMap.get(insight.segmentId);
        if (!segment) {
          return;
        }
        wrapInsightOccurrence(segment, insight);
      });

    if (activePanelState?.hostKey === hostKey) {
      refreshPanel();
    }
  }

  function openPanelByInsightId(hostKey, insightId, options = {}) {
    ensureUi();
    const context = getCurrentContext(hostKey);
    const registration = getHostRegistration(hostKey);
    if (!context || !registration?.host || !panelNode) {
      hidePanel();
      return;
    }
    const insight = context.insights.find((item) => item.id === insightId) || null;
    if (!insight) {
      hidePanel();
      return;
    }
    const anchor = registration.host.querySelector(`[data-selection-insight-anchor-id="${insightId.replace(/"/g, '\\"')}"]`);
    panelNode.innerHTML = buildPanelHtml(insight);
    panelNode.hidden = false;
    const anchorRect = anchor?.getBoundingClientRect?.() || options.fallbackRect || null;
    if (anchorRect) {
      setFixedPosition(panelNode, anchorRect, windowObject);
    }
    activePanelState = {
      hostKey,
      insightId,
      pinned: options.pinned === true,
      fallbackRect: options.fallbackRect || null
    };
  }

  function refreshPanel() {
    if (!activePanelState) {
      return;
    }
    openPanelByInsightId(activePanelState.hostKey, activePanelState.insightId, {
      pinned: activePanelState.pinned,
      fallbackRect: activePanelState.fallbackRect
    });
  }

  async function buildAgentSnapshot(projectId) {
    let syncResult = null;
    const storagePath = cleanText(state?.settings?.storagePath, 1200);
    if (api?.autoSaveDataFile && storagePath) {
      syncResult = await api.autoSaveDataFile(state, '');
      if (!syncResult?.ok) {
        throw new Error(syncResult?.error || 'Failed to sync state before running the answer request.');
      }
    }
    const snapshot = buildStateSnapshot(state, cleanText(projectId, 120));
    if (!snapshot.data_file_path) {
      snapshot.data_file_path = cleanText(syncResult?.filePath, 1600);
    }
    return snapshot;
  }

  async function requestInsightAnswer(context, selectionContext, actionType) {
    if (!api?.agentChat) {
      throw new Error('Agent IPC is unavailable in this build.');
    }
    const stateSnapshot = await buildAgentSnapshot(context?.projectId);
    const message = createSelectionInsightPrompt({
      actionType,
      selectedText: selectionContext.selectedText,
      segmentText: selectionContext.segmentText,
      context: {
        ...context,
        segmentLabel: selectionContext.segmentLabel
      }
    });
    const result = await api.agentChat({
      clientRequestId: `selection-insight-${cleanText(createId?.(), 120) || Date.now().toString(36)}`,
      message,
      attachments: [],
      chatSessionId: '',
      projectId: cleanText(context?.projectId, 120),
      projectName: cleanText(context?.projectName || context?.record?.projectName, 220),
      conversation: [],
      stateSnapshot,
      llm: {
        provider: cleanText(state?.settings?.llm?.provider, 80),
        model: cleanText(state?.settings?.llm?.model, 160),
        reasoningEffort: cleanText(state?.settings?.llm?.reasoningEffort, 40).toLowerCase(),
        apiEndpoint: cleanText(state?.settings?.llm?.provider, 80) === 'codex'
          ? ''
          : cleanText(state?.settings?.llm?.apiEndpoint, 1200),
        apiKey: cleanText(state?.settings?.llm?.provider, 80) === 'codex'
          ? ''
          : cleanText(state?.settings?.llm?.apiKey, 4000)
      },
      agent: {
        developerMode: state?.settings?.agent?.developerMode === true,
        deepResearchEnabled: false,
        selectionInsight: {
          actionType,
          selectedText: selectionContext.selectedText,
          contextText: selectionContext.segmentText,
          segmentLabel: selectionContext.segmentLabel,
          recordName: cleanText(
            context?.record?.name
              || context?.record?.protocolName
              || context?.label,
            220
          ),
          projectName: cleanText(
            context?.projectName
              || context?.record?.projectName,
            220
          )
        }
      }
    });
    if (!result?.ok) {
      throw new Error(result?.error || 'The selection insight request failed.');
    }
    return normalizeAgentResponse(result);
  }

  async function runInsightAction(hostKey, selectionContext, actionType) {
    hideMenu();
    const registration = getHostRegistration(hostKey);
    if (!registration || !selectionContext) {
      return;
    }

    let context = getCurrentContext(hostKey);
    if (!context) {
      return;
    }

    if (typeof context.ensureRecord === 'function') {
      await context.ensureRecord();
      context = getCurrentContext(hostKey);
      if (!context) {
        return;
      }
    }

    const pendingResult = updateInsightAnswers(
      context.insights,
      selectionContext,
      actionType,
      () => buildPendingAnswer(actionType, new Date().toISOString()),
      createId
    );
    const updatedPendingRecord = context.updateRecord?.((record) => ({
      ...record,
      selectionInsights: pendingResult.insights
    })) || null;

    const refreshedPendingContext = getCurrentContext(hostKey);
    if (updatedPendingRecord && refreshedPendingContext) {
      await persistInsightSidecar({
        api,
        context: {
          ...refreshedPendingContext,
          record: updatedPendingRecord
        },
        insights: pendingResult.insights
      });
    }
    refreshHost(hostKey);
    openPanelByInsightId(hostKey, pendingResult.insight.id, {
      pinned: true,
      fallbackRect: selectionContext.selectionRect
    });

    try {
      const response = await requestInsightAnswer(context, selectionContext, actionType);
      const completedResult = updateInsightAnswers(
        getCurrentContext(hostKey)?.insights || pendingResult.insights,
        {
          ...selectionContext,
          existingInsightId: pendingResult.insight.id
        },
        actionType,
        () => {
          const answer = buildCompletedAnswer(actionType, response);
          const pendingAnswer = pendingResult.insight.answers?.[actionType];
          if (pendingAnswer?.requestedAt) {
            answer.requestedAt = pendingAnswer.requestedAt;
          }
          return answer;
        },
        createId
      );
      const updatedRecord = getCurrentContext(hostKey)?.updateRecord?.((record) => ({
        ...record,
        selectionInsights: completedResult.insights
      })) || null;
      const refreshedContext = getCurrentContext(hostKey);
      if (updatedRecord && refreshedContext) {
        await persistInsightSidecar({
          api,
          context: {
            ...refreshedContext,
            record: updatedRecord
          },
          insights: completedResult.insights
        });
      }
      refreshHost(hostKey);
      openPanelByInsightId(hostKey, completedResult.insight.id, {
        pinned: true,
        fallbackRect: selectionContext.selectionRect
      });
    } catch (error) {
      const errorMessage = String(error?.message || error);
      const erroredResult = updateInsightAnswers(
        getCurrentContext(hostKey)?.insights || pendingResult.insights,
        {
          ...selectionContext,
          existingInsightId: pendingResult.insight.id
        },
        actionType,
        (pendingAnswer) => buildErroredAnswer(actionType, errorMessage, pendingAnswer),
        createId
      );
      const updatedRecord = getCurrentContext(hostKey)?.updateRecord?.((record) => ({
        ...record,
        selectionInsights: erroredResult.insights
      })) || null;
      const refreshedContext = getCurrentContext(hostKey);
      if (updatedRecord && refreshedContext) {
        await persistInsightSidecar({
          api,
          context: {
            ...refreshedContext,
            record: updatedRecord
          },
          insights: erroredResult.insights
        });
      }
      refreshHost(hostKey);
      openPanelByInsightId(hostKey, erroredResult.insight.id, {
        pinned: true,
        fallbackRect: selectionContext.selectionRect
      });
    }
  }

  function bindHostListeners(hostKey, host) {
    if (!host || host.dataset.selectionInsightsBound === 'true') {
      return;
    }
    host.dataset.selectionInsightsBound = 'true';

    host.addEventListener('contextmenu', (event) => {
      const selectionContext = getSelectionContext(hostKey);
      if (!selectionContext) {
        hideMenu();
        return;
      }
      ensureUi();
      event.preventDefault();
      activeMenuState = {
        hostKey,
        selectionContext
      };
      positionMenu(event.clientX, event.clientY);
    });

    host.addEventListener('pointerover', (event) => {
      const anchor = event.target?.closest?.('[data-selection-insight-anchor-id]');
      if (!anchor || !host.contains(anchor)) {
        return;
      }
      cancelHidePanel();
      openPanelByInsightId(hostKey, cleanText(anchor.dataset.selectionInsightAnchorId, 120), {
        pinned: false
      });
    });

    host.addEventListener('pointerout', (event) => {
      const anchor = event.target?.closest?.('[data-selection-insight-anchor-id]');
      if (!anchor || !host.contains(anchor)) {
        return;
      }
      const related = event.relatedTarget;
      if (isElementNode(related) && (anchor.contains(related) || panelNode?.contains?.(related))) {
        return;
      }
      if (!activePanelState?.pinned) {
        scheduleHidePanel();
      }
    });

    host.addEventListener('focusin', (event) => {
      const anchor = event.target?.closest?.('[data-selection-insight-anchor-id]');
      if (!anchor || !host.contains(anchor)) {
        return;
      }
      openPanelByInsightId(hostKey, cleanText(anchor.dataset.selectionInsightAnchorId, 120), {
        pinned: false
      });
    });

    host.addEventListener('focusout', (event) => {
      const anchor = event.target?.closest?.('[data-selection-insight-anchor-id]');
      if (!anchor || !host.contains(anchor)) {
        return;
      }
      const related = event.relatedTarget;
      if (isElementNode(related) && panelNode?.contains?.(related)) {
        return;
      }
      if (!activePanelState?.pinned) {
        scheduleHidePanel();
      }
    });
  }

  if (rootDocument) {
    ensureUi();
    rootDocument.addEventListener('click', (event) => {
      const target = event.target;
      if (!isElementNode(target)) {
        hideMenu();
        if (activePanelState?.pinned) {
          hidePanel();
        }
        return;
      }
      if (!menuNode?.contains(target)) {
        hideMenu();
      }
      if (panelNode?.contains(target)) {
        return;
      }
      if (target.closest('[data-selection-insight-anchor-id]')) {
        return;
      }
      if (activePanelState) {
        hidePanel();
      }
    });
    rootDocument.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        hideMenu();
        hidePanel();
      }
    });
    rootDocument.addEventListener('scroll', () => {
      if (activeMenuState) {
        hideMenu();
      }
      refreshPanel();
    }, true);
  }

  windowObject?.addEventListener?.('resize', () => {
    hideMenu();
    refreshPanel();
  });

  return {
    registerHost({ key, host, getContext }) {
      const hostKey = cleanText(key, 120);
      if (!hostKey || !host || typeof getContext !== 'function') {
        return;
      }
      hosts.set(hostKey, { key: hostKey, host, getContext });
      bindHostListeners(hostKey, host);
    },
    refreshHost,
    hideMenu,
    hidePanel
  };
}
