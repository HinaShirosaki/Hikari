import { createMarkdownRevision, fieldsForRecord } from '../../shared/record-markdown/fields.mjs';
import { showTransientNotice } from '../lib/notify.js';

const queues = new WeakMap();
const revisionKey = revision => JSON.stringify(revision);

function trimHistory(queue, history, latest) {
  for (const key of history) {
    if (history.size <= 64) break;
    if (!queue.pendingRevisions.has(key) && key !== revisionKey(latest)) history.delete(key);
  }
}

// Capture records before hashing/IPC, and acknowledge only still-matching live
// records. An old save must not advance the revision of a newer editor change.
export async function syncMarkdownRecordState(api, state, filePath = '') {
  const snapshot = structuredClone(state);
  let roots = queues.get(state);
  if (!roots) { roots = new Map(); queues.set(state, roots); }
  const root = String(snapshot.settings?.storagePath || filePath);
  let queue = roots.get(root);
  if (!queue) { queue = { pending: Promise.resolve(), revisions: new Map(), pendingRevisions: new Map() }; roots.set(root, queue); }
  // Keep captured baselines until every queued save using them has finished.
  // The bounded history must not evict the baseline of a large typing burst.
  const captured = new Set([...(snapshot.protocols || []), ...(snapshot.notebookEntries || [])]
    .filter(record => record?.markdownRevision).map(record => revisionKey(record.markdownRevision)));
  for (const key of captured) queue.pendingRevisions.set(key, (queue.pendingRevisions.get(key) || 0) + 1);
  const work = async () => {
    const submitted = [];
    for (const [key, kind] of [['protocols', 'protocol'], ['notebookEntries', 'notebook']]) {
      for (const record of snapshot[key] || []) {
        if (!record || typeof record !== 'object' || Array.isArray(record)) continue;
        const revision = await createMarkdownRevision(record, kind);
        const identity = `${kind}:${record.id}`;
        const acknowledged = queue.revisions.get(identity);
        // Later saves can be captured before an earlier save is acknowledged.
        // Rebase only this client's known revisions, never a newly loaded one.
        if (acknowledged && (!record.markdownRevision || acknowledged.history.has(revisionKey(record.markdownRevision)))) {
          record.markdownRevision = acknowledged.latest;
        }
        revision.origin = record.markdownRevision?.origin || globalThis.crypto.randomUUID();
        submitted.push({ key, kind, id: record.id, identity, before: record.markdownRevision, revision, fields: JSON.stringify(fieldsForRecord(record, kind)) });
      }
    }
    const result = await api.autoSaveDataFile(snapshot, filePath);
    if (result?.ok) {
      const skipped = result.sidecarPaths?.skippedRecords || [];
      const notSaved = new Set(skipped.map(record => `${record.kind}:${record.id}`));
      const active = new Set();
      for (const item of submitted) {
        active.add(item.identity);
        // A skipped record was not written; its next save needs the old baseline.
        if (notSaved.has(item.identity)) continue;
        const history = queue.revisions.get(item.identity)?.history || new Set();
        if (item.before) history.add(revisionKey(item.before));
        history.add(revisionKey(item.revision));
        trimHistory(queue, history, item.revision);
        queue.revisions.set(item.identity, { latest: item.revision, history });
        const live = (state[item.key] || []).find(record => record.id === item.id);
        if (live && JSON.stringify(fieldsForRecord(live, item.kind)) === item.fields) {
          const saved = result.markdownRecords?.[item.key]?.find(record => record.id === item.id);
          // Only an unchanged live record takes the merged prose. The history
          // keeps what this client sent, so a save edited or queued before
          // this acknowledgment rebases to that text and keeps the merged edit.
          if (saved) {
            for (const field of Object.keys(fieldsForRecord(saved, item.kind))) {
              if (Object.hasOwn(saved, field)) live[field] = structuredClone(saved[field]);
              else delete live[field];
            }
            if (item.kind === 'protocol' && !Object.hasOwn(saved, 'description')) delete live.description;
            live.markdownRevision = { ...await createMarkdownRevision(saved, item.kind), origin: item.revision.origin };
          } else live.markdownRevision = item.revision;
        }
      }
      for (const identity of queue.revisions.keys()) if (!active.has(identity)) queue.revisions.delete(identity);
      // Warn when the problems change or a skipped record gets more unsaved
      // edits, rather than on every autosave.
      const notice = skipped.map(record => record.message).join('\n');
      const unsaved = notice ? JSON.stringify(submitted.filter(item => notSaved.has(item.identity))
        .map(item => snapshot[item.key].find(record => record.id === item.id))) : '';
      if (notice && notice + unsaved !== queue.skippedNotice) showTransientNotice(notice, { type: 'error', durationMs: 15000 });
      queue.skippedNotice = notice + unsaved;
    }
    return result;
  };
  const operation = queue.pending.catch(() => {}).then(work);
  queue.pending = operation;
  try { return await operation; }
  finally {
    for (const key of captured) {
      const count = queue.pendingRevisions.get(key) - 1;
      if (count) queue.pendingRevisions.set(key, count);
      else queue.pendingRevisions.delete(key);
    }
    for (const { history, latest } of queue.revisions.values()) trimHistory(queue, history, latest);
  }
}
