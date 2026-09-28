import { normalizeNotebookState, cloneProtocolSnapshot } from '../entry/entry-helpers.js';
import { asArray } from '../../../lib/normalize.js';

export { normalizeNotebookState };

function trimText(value, limit = 0) {
  const text = String(value || '').trim();
  return limit > 0 ? text.slice(0, limit) : text;
}

export function resolveNotebookDraftProposalId(draft) {
  return trimText(
    draft?.proposal?.proposal_id
      || draft?.entry_template?.agentDraftMeta?.proposalId,
    160
  );
}

export function findNotebookEntryByProposalId(notebookEntries, proposalId) {
  const normalizedProposalId = trimText(proposalId, 160);
  if (!normalizedProposalId) {
    return null;
  }
  return asArray(notebookEntries).find((entry) => (
    trimText(entry?.agentDraftMeta?.proposalId, 160) === normalizedProposalId
  )) || null;
}

export function findNotebookEntryForDraft(notebookEntries, draft) {
  const byProposalId = findNotebookEntryByProposalId(
    notebookEntries,
    resolveNotebookDraftProposalId(draft)
  );
  if (byProposalId) {
    return byProposalId;
  }

  const entryId = trimText(draft?.entry_template?.id, 120);
  if (!entryId) {
    return null;
  }

  return asArray(notebookEntries).find((entry) => (
    trimText(entry?.id, 120) === entryId
  )) || null;
}

export function normalizeNotebookDraft(rawDraft) {
  if (!rawDraft || typeof rawDraft !== 'object') {
    return null;
  }
  const placeholderValues = asArray(rawDraft.placeholder_values).map((item) => ({
    placeholder_key: trimText(item?.placeholder_key, 120),
    display: trimText(item?.display, 120),
    value: trimText(item?.value, 260),
    source: trimText(item?.source, 120),
    source_type: trimText(item?.source_type, 80)
  })).filter((item) => item.placeholder_key && item.value);

  const unresolvedPlaceholders = asArray(rawDraft.unresolved_placeholders).map((item) => ({
    placeholder_key: trimText(item?.placeholder_key, 120),
    display: trimText(item?.display, 120),
    reason: trimText(item?.reason, 120)
  })).filter((item) => item.placeholder_key);

  const entryTemplate = rawDraft.entry_template && typeof rawDraft.entry_template === 'object'
    ? rawDraft.entry_template
    : {};
  const proposal = rawDraft.proposal && typeof rawDraft.proposal === 'object'
    ? rawDraft.proposal
    : {};

  return {
    protocol: {
      id: trimText(rawDraft?.protocol?.id, 120),
      name: trimText(rawDraft?.protocol?.name, 220)
    },
    project: {
      id: trimText(rawDraft?.project?.id, 80),
      name: trimText(rawDraft?.project?.name, 180),
      resolution_source: trimText(rawDraft?.project?.resolution_source, 80)
    },
    notebook_type: trimText(rawDraft?.notebook_type, 40) || 'biology',
    proposal: {
      proposal_id: trimText(proposal.proposal_id, 160),
      title: trimText(proposal.title, 220),
      purpose: trimText(proposal.purpose, 500),
      rationale: trimText(proposal.rationale, 700),
      planned_materials: asArray(proposal.planned_materials).map((item) => trimText(item, 220)).filter(Boolean),
      checkpoints: asArray(proposal.checkpoints).map((item) => trimText(item, 220)).filter(Boolean),
      workflow: proposal.workflow && typeof proposal.workflow === 'object'
        ? {
          id: trimText(proposal.workflow.id, 120),
          name: trimText(proposal.workflow.name, 220),
          block_id: trimText(proposal.workflow.block_id, 120),
          block_title: trimText(proposal.workflow.block_title, 220)
        }
        : null
    },
    rendered_steps: asArray(rawDraft.rendered_steps).map((step) => String(step || '').trim()).filter(Boolean),
    placeholder_values: placeholderValues,
    unresolved_placeholders: unresolvedPlaceholders,
    save: {
      mode: trimText(rawDraft?.save?.mode, 80) || 'auto_save_draft',
      applied: rawDraft?.save?.applied === true,
      status: trimText(rawDraft?.save?.status, 120),
      reason: trimText(rawDraft?.save?.reason, 220)
    },
    entry_template: {
      id: trimText(entryTemplate.id, 120),
      notebookType: trimText(entryTemplate.notebookType, 40) || 'biology',
      projectId: trimText(entryTemplate.projectId, 80),
      projectName: trimText(entryTemplate.projectName, 180),
      protocolId: trimText(entryTemplate.protocolId, 120),
      protocolName: trimText(entryTemplate.protocolName, 220),
      experimentName: trimText(entryTemplate.experimentName || proposal.title, 220),
      protocolSnapshot: cloneProtocolSnapshot(entryTemplate.protocolSnapshot),
      values: entryTemplate.values && typeof entryTemplate.values === 'object' ? entryTemplate.values : {},
      result: trimText(entryTemplate.result, 40000),
      updatedAt: trimText(entryTemplate.updatedAt, 80),
      notebookState: normalizeNotebookState(entryTemplate.notebookState),
      executedAt: trimText(entryTemplate.executedAt, 80),
      resultFiles: asArray(entryTemplate.resultFiles).map((value) => trimText(value, 220)).filter(Boolean),
      resultFileRecords: asArray(entryTemplate.resultFileRecords),
      agentDraftStatus: trimText(entryTemplate.agentDraftStatus, 80),
      agentDraftMeta: entryTemplate.agentDraftMeta && typeof entryTemplate.agentDraftMeta === 'object'
        ? entryTemplate.agentDraftMeta
        : {}
    }
  };
}

export function buildNotebookEntryFromDraft(draft, requestText = '', options = {}) {
  const template = draft?.entry_template && typeof draft.entry_template === 'object'
    ? draft.entry_template
    : {};
  const nowIso = new Date().toISOString();
  const unresolvedCount = asArray(draft?.unresolved_placeholders).length;
  const proposalId = resolveNotebookDraftProposalId(draft);
  const notebookState = normalizeNotebookState(
    template.notebookState || (draft?.save?.mode === 'confirm_before_save' ? 'planned' : 'executed')
  );
  const updatedAt = trimText(template.updatedAt, 80) || nowIso;
  const executedAt = notebookState !== 'executed'
    ? ''
    : (trimText(template.executedAt, 80) || updatedAt);
  const createId = typeof options.createId === 'function'
    ? options.createId
    : (() => `agent-draft-${Date.now()}`);

  return {
    id: createId(),
    notebookType: trimText(template.notebookType, 40) || trimText(draft?.notebook_type, 40) || 'biology',
    projectId: trimText(template.projectId, 80) || trimText(draft?.project?.id, 80),
    projectName: trimText(template.projectName, 180) || trimText(draft?.project?.name, 180),
    protocolId: trimText(template.protocolId, 120) || trimText(draft?.protocol?.id, 120),
    protocolName: trimText(template.protocolName, 220) || trimText(draft?.protocol?.name, 220),
    experimentName: trimText(template.experimentName || draft?.proposal?.title, 220),
    protocolSnapshot: cloneProtocolSnapshot(template.protocolSnapshot),
    createdAt: updatedAt,
    values: template.values && typeof template.values === 'object' ? template.values : {},
    result: trimText(template.result, 40000) || `Agent-generated notebook draft from request: ${trimText(requestText, 220)}`,
    resultFiles: asArray(template.resultFiles),
    resultFileRecords: asArray(template.resultFileRecords),
    updatedAt,
    notebookState,
    executedAt,
    agentDraftStatus: trimText(template.agentDraftStatus, 80) || (unresolvedCount > 0 ? 'needs_review' : 'draft_ready'),
    agentDraftMeta: {
      ...(template.agentDraftMeta && typeof template.agentDraftMeta === 'object' ? template.agentDraftMeta : {}),
      proposalId,
      savedAt: trimText(options.savedAt, 80) || nowIso,
      unresolvedCount,
      source: trimText(template?.agentDraftMeta?.source, 80)
        || (draft?.save?.mode === 'confirm_before_save' ? 'agent_notebook_draft_v1' : 'agent_phase5')
    }
  };
}

function notifyNotebookEntriesChanged(callback) {
  try {
    callback?.();
  } catch {
    // Domain persistence must remain successful if a downstream view is not mounted.
  }
}

export function applyNotebookDraftAutoSave(rawDraft, requestText, options = {}) {
  const draft = normalizeNotebookDraft(rawDraft);
  if (!draft || draft.save.mode !== 'auto_save_draft') {
    return draft;
  }

  const template = draft.entry_template || {};
  const projectId = template.projectId || draft.project.id;
  const protocolId = template.protocolId || draft.protocol.id;
  if (!projectId || !protocolId) {
    return {
      ...draft,
      save: {
        ...draft.save,
        applied: false,
        status: 'autosave_skipped',
        reason: 'Missing project or protocol binding for draft auto-save.'
      }
    };
  }

  const entry = buildNotebookEntryFromDraft(draft, requestText, {
    createId: options.createId,
    savedAt: options.savedAt
  });
  const state = options.state && typeof options.state === 'object' ? options.state : null;
  if (!state) {
    return {
      ...draft,
      save: {
        ...draft.save,
        applied: false,
        status: 'autosave_skipped',
        reason: 'Notebook state is unavailable for draft auto-save.'
      }
    };
  }

  state.notebookEntries = asArray(state.notebookEntries);
  state.notebookEntries.push(entry);
  notifyNotebookEntriesChanged(options.onNotebookEntriesChanged);

  return {
    ...draft,
    save: {
      ...draft.save,
      applied: true,
      status: 'saved_draft',
      reason: 'Draft auto-saved to notebook entries.'
    },
    entry_template: {
      ...draft.entry_template,
      ...entry
    }
  };
}

export function createPlannedNotebookPage(rawDraft, requestText, options = {}) {
  const draft = normalizeNotebookDraft(rawDraft);
  if (!draft || draft.save.mode !== 'confirm_before_save') {
    return { ok: false, reason: 'unavailable', draft, entry: null, created: false };
  }

  const state = options.state && typeof options.state === 'object' ? options.state : null;
  if (!state) {
    return { ok: false, reason: 'state_unavailable', draft, entry: null, created: false };
  }

  const existingEntry = findNotebookEntryForDraft(state.notebookEntries, draft);
  if (existingEntry) {
    return {
      ok: true,
      created: false,
      entry: existingEntry,
      draft: {
        ...draft,
        save: {
          ...draft.save,
          applied: true,
          status: 'already_created',
          reason: 'Planned page already exists for this proposal.'
        },
        entry_template: {
          ...draft.entry_template,
          ...existingEntry
        }
      }
    };
  }

  const entry = buildNotebookEntryFromDraft(draft, requestText, {
    createId: options.createId,
    savedAt: options.savedAt
  });
  if (!entry.projectId || !entry.protocolId) {
    return { ok: false, reason: 'missing_binding', draft, entry: null, created: false };
  }

  state.notebookEntries = asArray(state.notebookEntries);
  state.notebookEntries.push(entry);
  notifyNotebookEntriesChanged(options.onNotebookEntriesChanged);

  return {
    ok: true,
    created: true,
    entry,
    draft: {
      ...draft,
      save: {
        ...draft.save,
        applied: true,
        status: 'planned_page_created',
        reason: 'Planned page created from assistant proposal.'
      },
      entry_template: {
        ...draft.entry_template,
        ...entry
      }
    }
  };
}

export function createNotebookDraftAgentAdapter({
  state,
  createId,
  onNotebookEntriesChanged
} = {}) {
  return {
    normalizeDraft: normalizeNotebookDraft,
    normalizeState: normalizeNotebookState,
    resolveProposalId: resolveNotebookDraftProposalId,
    findEntryForDraft: (draft) => findNotebookEntryForDraft(state?.notebookEntries, draft),
    applyAutoSave: (rawDraft, requestText) => applyNotebookDraftAutoSave(rawDraft, requestText, {
      state,
      createId,
      onNotebookEntriesChanged
    }),
    createPlannedPage: (rawDraft, requestText) => createPlannedNotebookPage(rawDraft, requestText, {
      state,
      createId,
      onNotebookEntriesChanged
    })
  };
}
