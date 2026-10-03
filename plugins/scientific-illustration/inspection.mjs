const CANVASES = ['main', 'scratch'];
export const INSPECTION_CHECKS = ['layout', 'labels', 'artwork', 'science'];

// Ephemeral receipts prove a preview was generated in this run, for this exact
// revision. Reload, another run, or any saved edit requires a fresh inspection.
export function createInspectionTracker() {
  const runs = new Map();
  function current(illustrationId, revision, runId) {
    const entry = runs.get(runId);
    return entry?.illustrationId === illustrationId && entry.revision === revision ? entry : null;
  }
  function status(illustrationId, revision, runId, includeToken = false) {
    const entry = current(illustrationId, revision, runId);
    return { required: true, complete: Boolean(entry?.review), revision,
      rendered_canvases: CANVASES.filter(canvas => entry?.canvases.has(canvas)),
      ...(includeToken && entry?.token ? { inspection_id: entry.token } : {}),
      ...(entry?.review ? { review: entry.review } : {}) };
  }
  function rendered(illustrationId, revision, runId, canvases) {
    let entry = current(illustrationId, revision, runId);
    if (!entry) {
      entry = { illustrationId, revision, canvases: new Set() };
      runs.delete(runId); runs.set(runId, entry);
      if (runs.size > 64) runs.delete(runs.keys().next().value);
    }
    for (const canvas of canvases) entry.canvases.add(canvas);
    if (CANVASES.every(canvas => entry.canvases.has(canvas))) entry.token ||= crypto.randomUUID();
    return status(illustrationId, revision, runId, true);
  }
  function inspect(illustrationId, revision, runId, args) {
    const entry = current(illustrationId, revision, runId);
    if (args.expected_revision !== revision || !entry?.token || args.inspection_id !== entry.token) {
      return { ok: false, status: 'inspection_required', error: 'Render both canvases at the current revision, inspect their images, then submit the returned inspection_id and expected_revision.' };
    }
    entry.review = Object.fromEntries(INSPECTION_CHECKS.map(key => [key, args.review[key].trim()]));
    return { ok: true, status: 'inspected', illustration_id: illustrationId, revision,
      inspection: status(illustrationId, revision, runId) };
  }
  return { status, rendered, inspect };
}
