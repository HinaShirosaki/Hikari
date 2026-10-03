import { showTransientNotice } from '../../../lib/notify.js';
import { isAgentAvailable } from '../../../lib/agent-availability.js';
import { mergeNotebookValues, pruneNotebookValuesForProtocol } from '../entry/entry-helpers.js';
import { logNotebookPageEvent } from '../../../services/notebook-page-log.js';
import {
  areAllNotebookPlaceholdersFilled,
  generateNotebookPageName,
  resolveNotebookExperimentNameSource
} from '../entry/page-name-generator.js';

// Naming a notebook page: the protocol-derived default, the one-shot generated
// name, and the inline rename that marks the title as user-owned.
function createNotebookPageNaming({
  elements,
  entryListRenderer,
  getActiveEntry,
  updateNotebookEntryRecord,
  resolveViewerProtocol,
  collectNotebookValues,
  getCurrentDraftSnapshot,
  markDraftSaved,
  state,
  onNotebookEntriesChanged,
  notifyActiveNotebookPageChanged,
  getExperimentNameSourceDraft,
  setExperimentNameSourceDraft,
  setExperimentNameGeneratedAtDraft,
  getExperimentNameGeneratedModelDraft,
  setExperimentNameGeneratedModelDraft,
  getPageNameGenerationRevision,
  setPageNameGenerationRevision,
  getPageNameGenerationPendingRevision,
  setPageNameGenerationPendingRevision,
  getPageNameGenerationPromise,
  setPageNameGenerationPromise,
  getNotebookTitleRenameStartValue,
  setNotebookTitleRenameStartValue,
  getSavedDraftSnapshot
} = {}) {
  const {
    notebookProtocolArea,
    notebookProtocolTitle,
    notebookExperimentName
  } = elements;

  function syncNotebookTitle(protocol = null) {
    if (!notebookProtocolTitle) {
      return;
    }
    const fallbackName = String(protocol?.name || '').trim() || 'Notebook Page';
    const experimentName = String(notebookExperimentName?.value || '').trim();
    notebookProtocolTitle.textContent = experimentName || fallbackName;
  }

  function resetNotebookNameGenerationState(entry = null, protocol = null) {
    setExperimentNameSourceDraft(resolveNotebookExperimentNameSource(entry, protocol));
    setExperimentNameGeneratedAtDraft(getExperimentNameSourceDraft() === 'generated'
      ? String(entry?.experimentNameGeneratedAt || '').trim()
      : '');
    setExperimentNameGeneratedModelDraft(getExperimentNameSourceDraft() === 'generated'
      ? String(entry?.experimentNameGeneratedModel || '').trim()
      : '');
    setPageNameGenerationRevision(getPageNameGenerationRevision() + 1);
    setPageNameGenerationPendingRevision(-1);
    setPageNameGenerationPromise(null);
  }

  function markNotebookNameAsUserRenamed() {
    setExperimentNameSourceDraft('user');
    setExperimentNameGeneratedAtDraft('');
    setExperimentNameGeneratedModelDraft('');
    setPageNameGenerationRevision(getPageNameGenerationRevision() + 1);
    setPageNameGenerationPendingRevision(-1);
    setPageNameGenerationPromise(null);
  }

  function applyGeneratedNotebookPageName(generated, protocol) {
    const name = String(generated?.name || '').trim();
    if (!name || getExperimentNameSourceDraft() !== 'protocol') {
      return null;
    }
    const hadUnsavedChanges = Boolean(
      getSavedDraftSnapshot()
      && getCurrentDraftSnapshot() !== getSavedDraftSnapshot()
    );
    const generatedAt = new Date().toISOString();
    setExperimentNameSourceDraft('generated');
    setExperimentNameGeneratedAtDraft(generatedAt);
    setExperimentNameGeneratedModelDraft(String(generated?.model || '').trim());
    if (notebookExperimentName) {
      notebookExperimentName.value = name;
    }
    syncNotebookTitle(protocol);

    const activeEntry = getActiveEntry();
    if (!activeEntry) {
      return null;
    }
    const nextEntry = updateNotebookEntryRecord(activeEntry.id, (currentEntry) => ({
      ...currentEntry,
      experimentName: name,
      experimentNameSource: 'generated',
      experimentNameGeneratedAt: generatedAt,
      experimentNameGeneratedModel: getExperimentNameGeneratedModelDraft(),
      updatedAt: generatedAt
    }));
    if (!nextEntry) {
      return null;
    }
    logNotebookPageEvent({
      entry: nextEntry,
      storagePath: state.settings?.storagePath,
      action: 'name-generate',
      summary: `Generated notebook page name "${name}"`,
      details: {
        model: getExperimentNameGeneratedModelDraft(),
        provider: String(generated?.provider || '').trim()
      }
    });
    entryListRenderer.renderEntries();
    if (typeof onNotebookEntriesChanged === 'function') {
      onNotebookEntriesChanged();
    }
    notifyActiveNotebookPageChanged();
    if (!hadUnsavedChanges) {
      markDraftSaved();
    }
    return nextEntry;
  }

  function maybeGenerateNotebookPageName({ protocol: protocolOverride = null, values: valuesOverride = null } = {}) {
    if (!window.hikariApi?.runDirectLlmPrompt || !isAgentAvailable() || getExperimentNameSourceDraft() !== 'protocol') {
      return Promise.resolve(null);
    }
    const entry = getActiveEntry();
    const protocol = protocolOverride || resolveViewerProtocol(entry);
    if (!protocol) {
      return Promise.resolve(null);
    }
    const values = valuesOverride || pruneNotebookValuesForProtocol(
      mergeNotebookValues(entry?.values, collectNotebookValues()),
      protocol
    );
    if (!areAllNotebookPlaceholdersFilled(protocol, values)) {
      return Promise.resolve(null);
    }

    const revision = getPageNameGenerationRevision();
    if (getPageNameGenerationPendingRevision() === revision && getPageNameGenerationPromise()) {
      return getPageNameGenerationPromise();
    }
    const expectedEntryId = String(entry?.id || '').trim();
    const expectedProtocolId = String(protocol?.id || '').trim();
    setPageNameGenerationPendingRevision(revision);
    const request = (async () => {
      try {
        const generated = await generateNotebookPageName({
          llm: state.settings?.llm || {},
          protocol,
          values
        });
        const currentEntry = getActiveEntry();
        const currentProtocol = resolveViewerProtocol(currentEntry);
        if (
          revision !== getPageNameGenerationRevision()
          || getExperimentNameSourceDraft() !== 'protocol'
          || String(currentEntry?.id || '').trim() !== expectedEntryId
          || String(currentProtocol?.id || '').trim() !== expectedProtocolId
        ) {
          return null;
        }
        applyGeneratedNotebookPageName(generated, currentProtocol || protocol);
        return generated;
      } catch (error) {
        console.warn('Failed to generate notebook page name:', error);
        showTransientNotice('Could not generate a page name automatically.', { type: 'error' });
        return null;
      } finally {
        if (getPageNameGenerationPendingRevision() === revision) {
          setPageNameGenerationPendingRevision(-1);
          setPageNameGenerationPromise(null);
        }
      }
    })();
    setPageNameGenerationPromise(request);
    return request;
  }

  function onNotebookPlaceholderInput(event) {
    if (!event?.target?.dataset?.nbKey) {
      return;
    }
    void maybeGenerateNotebookPageName();
  }

  function beginNotebookTitleRename() {
    if (!notebookExperimentName || !notebookProtocolTitle || notebookProtocolArea?.hidden) {
      return;
    }
    setNotebookTitleRenameStartValue(String(notebookExperimentName.value || '').trim());
    notebookProtocolTitle.hidden = true;
    notebookExperimentName.hidden = false;
    notebookExperimentName.focus?.();
    const valueLength = String(notebookExperimentName.value || '').length;
    notebookExperimentName.setSelectionRange?.(0, valueLength);
  }

  function finishNotebookTitleRename({ cancel = false } = {}) {
    if (!notebookExperimentName || !notebookProtocolTitle) {
      return;
    }
    const activeProtocol = resolveViewerProtocol(getActiveEntry());
    if (!cancel) {
      const cleanName = String(notebookExperimentName.value || '').trim();
      notebookExperimentName.value = cleanName || String(activeProtocol?.name || '').trim();
      if (notebookExperimentName.value !== getNotebookTitleRenameStartValue()) {
        markNotebookNameAsUserRenamed();
      }
    } else {
      notebookExperimentName.value = getNotebookTitleRenameStartValue();
    }
    syncNotebookTitle(activeProtocol);
    notebookExperimentName.hidden = true;
    notebookProtocolTitle.hidden = false;
    setNotebookTitleRenameStartValue('');
  }

  return {
    syncNotebookTitle,
    resetNotebookNameGenerationState,
    markNotebookNameAsUserRenamed,
    applyGeneratedNotebookPageName,
    maybeGenerateNotebookPageName,
    onNotebookPlaceholderInput,
    beginNotebookTitleRename,
    finishNotebookTitleRename
  };
}

export { createNotebookPageNaming };
