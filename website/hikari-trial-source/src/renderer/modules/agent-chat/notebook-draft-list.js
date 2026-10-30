import { asArray, trimText } from './shared.js';

export function collectNotebookDrafts(meta = {}, adapter) {
  const source = asArray(meta.notebookDrafts).length ? meta.notebookDrafts : [meta.notebookDraft];
  return source.map((raw, index) => {
    const draft = adapter?.normalizeDraft?.(raw) || null;
    const draftId = trimText(adapter?.resolveProposalId?.(draft)
      || draft?.proposal?.proposal_id || draft?.entry_template?.agentDraftMeta?.proposalId, 160) || `draft-${index}`;
    return { draft, draftId, index };
  }).filter((item) => item.draft);
}

export function findNotebookDraft(meta, adapter, draftId = '') {
  const drafts = collectNotebookDrafts(meta, adapter);
  return draftId ? drafts.find((item) => item.draftId === draftId) : drafts[0];
}
