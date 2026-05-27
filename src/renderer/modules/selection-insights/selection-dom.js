import { TEXT_NODE } from './constants.js';
import { cleanText, clamp } from './text-utils.js';

export function shouldSkipTextNode(node) {
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

export function collectSegmentTextEntries(segmentElement) {
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

export function getSegmentPlainText(segmentElement) {
  return collectSegmentTextEntries(segmentElement)
    .map((entry) => entry.text)
    .join('');
}

export function unwrapInsightAnchors(host) {
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

export function locateOffsetInEntries(entries, absoluteOffset) {
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

export function findOccurrenceStart(segmentText, selectedText, occurrenceIndex = 1) {
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

export function wrapInsightOccurrence(segmentElement, insight) {
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

export function setFixedPosition(node, rect, windowObject) {
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
