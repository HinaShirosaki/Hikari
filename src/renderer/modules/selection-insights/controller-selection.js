import { TEXT_NODE } from './constants.js';
import { getCurrentContext, getHostRegistration } from './controller-context.js';
import { hidePanel, refreshPanel } from './controller-ui.js';
import {
  collectSegmentTextEntries,
  unwrapInsightAnchors,
  wrapInsightOccurrence
} from './selection-dom.js';
import { asArray, cleanText, clamp } from './text-utils.js';

export function getSelectionContext(ctx, hostKey) {
  const registration = getHostRegistration(ctx, hostKey);
  const host = registration?.host || null;
  if (!host || !ctx.windowObject?.getSelection) {
    return null;
  }
  const selection = ctx.windowObject.getSelection();
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

export function refreshHost(ctx, hostKey) {
  const registration = getHostRegistration(ctx, hostKey);
  const host = registration?.host || null;
  const context = getCurrentContext(ctx, hostKey);
  if (!host) {
    return;
  }

  if (!context) {
    unwrapInsightAnchors(host);
    if (ctx.activePanelState?.hostKey === hostKey) {
      hidePanel(ctx);
    }
    return;
  }

  unwrapInsightAnchors(host);

  if (!context.insights.length) {
    if (ctx.activePanelState?.hostKey === hostKey) {
      refreshPanel(ctx);
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

  if (ctx.activePanelState?.hostKey === hostKey) {
    refreshPanel(ctx);
  }
}
