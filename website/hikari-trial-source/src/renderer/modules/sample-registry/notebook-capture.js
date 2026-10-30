import { buildNotebookSampleCapture } from './notebook-capture-record.js';

export { buildNotebookSampleCapture } from './notebook-capture-record.js';

function appendNotebookResultLine(source, line) {
  const cleanLine = String(line || '').trim();
  if (!cleanLine) {
    return String(source || '').trim();
  }
  const current = String(source || '').trim();
  return current ? `${current}\n${cleanLine}` : cleanLine;
}

// Links a just-saved sample to the page that started the capture: appends a
// sampleLink and a timestamped note to the page result, then clears the
// pending capture (also cleared if the page is gone). Caller persists.
export function appendPendingNotebookSampleCapture(ctx, record) {
  const capture = ctx.state.settings?.pendingNotebookSampleCapture;
  const built = buildNotebookSampleCapture(ctx, record, capture);
  if (!built) {
    if (ctx.state.settings) {
      ctx.state.settings.pendingNotebookSampleCapture = null;
    }
    return null;
  }
  const { entryIndex, sampleLink, note, savedAt } = built;
  const currentEntry = ctx.state.notebookEntries[entryIndex];
  const nextEntry = {
    ...currentEntry,
    result: appendNotebookResultLine(currentEntry?.result, note),
    sampleLinks: (Array.isArray(currentEntry?.sampleLinks) ? currentEntry.sampleLinks : []).concat(sampleLink),
    updatedAt: savedAt
  };

  ctx.state.notebookEntries[entryIndex] = nextEntry;
  ctx.state.settings.pendingNotebookSampleCapture = null;
  return nextEntry;
}
