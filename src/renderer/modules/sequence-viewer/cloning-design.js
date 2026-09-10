import { escapeHtml } from '../../lib/html.js';
import { clamp, cleanText, normalizeSequenceText } from './shared.js';
import { copyPrimerValueFromEvent } from './primer-copy.js';
import { annotatePrimersOnSelectedRecord } from './primer-annotation.js';
import { createDonorSelection } from './cloning-design/donor-selection.js';
import { createProteinBuilderCloningNotebookPage } from './protein-builder-cloning-notebook.js';
import { createSequenceViewerCloningDesignNotebookPage } from './cloning-design-notebook.js';
import { confirmCloningDesign, describeCloningDesignConfirmation } from './cloning-design-confirm.js';
import { asArray } from '../../lib/normalize.js';
import { buildSourceKey, deriveDefaultInsertRange, getEditEndIndex, getEditStartIndex } from './cloning-design/edit-ranges.js';
import { formatEditType, formatStrategyLabel } from './cloning-design/formatting.js';
import { buildDisplayPlan } from './cloning-design/plan-building.js';
import { isVisibleElement, renderPlanSummary, renderPrimerTable, renderProcedure, renderRestrictionEnzymes, renderWarnings } from './cloning-design/plan-rendering.js';
import { RESTRICTION_LIGATION_STRATEGY, STRATEGIES, STRATEGY_WHOLE_PLASMID, cloningStrategyUsesDonor, cloningStrategyUsesInsertRange, isCloningDesignPlanActionable } from './cloning-design/strategies.js';

export function createSequenceViewerCloningDesignController(config = {}) {
  const elements = config?.elements || {};
  const state = config?.state || {};
  const getSelectedRecord = config?.getSelectedRecord || (() => null);
  const getCloningDesignSource = config?.getCloningDesignSource || (() => null);
  const setStatus = config?.setStatus || (() => {});
  const persistFeatureMutation = config?.persistFeatureMutation || (async () => {});
  const onRequestPrimerOrder = config?.onRequestPrimerOrder || (() => {});
  const getBridge = config?.getBridge || (() => null);
  const getStoragePath = config?.getStoragePath || (() => '');
  const onNavigateCloningDesign = config?.onNavigateCloningDesign || (() => {});
  const onReturnToDetail = config?.onReturnToDetail || (() => {});
  const onDesignConfirmed = config?.onDesignConfirmed || (async () => {});
  const appState = config?.appState;
  const persist = config?.persist;
  const createId = config?.createId;
  const onNotebookEntriesChanged = config?.onNotebookEntriesChanged;

  const {
    resetDonor,
    selectDonorEntry,
    getActiveDonor,
    renderDonorPanel,
    isDonorHydrationPending
  } = createDonorSelection({
    state,
    elements,
    getBridge,
    getStoragePath,
    getDesignState: () => getDesignState(),
    setStatus,
    syncControls: () => syncControls(),
    render: () => render()
  });
  // Confirming writes two library entries, so the button stays down until both
  // have settled rather than letting a double click write the product twice.
  let confirmPending = false;
  // Hydrating a seeded donor is a disk read. Designing before it lands templates
  // the PCR off this record instead, so every insert route comes back
  // infeasible -- and that stale plan stays on screen once the donor arrives,
  // because a re-render does not re-run the design.
  let donorReady = Promise.resolve();


  function availableStrategies() {
    const supported = getCloningDesignSource()?.supportedStrategies;
    return Array.isArray(supported)
      ? supported.map((id) => [...STRATEGIES, RESTRICTION_LIGATION_STRATEGY].find((strategy) => strategy.id === id)).filter(Boolean)
      : STRATEGIES;
  }

  function getDesignState() {
    if (!state.cloningDesign || typeof state.cloningDesign !== 'object') {
      state.cloningDesign = {};
    }
    if (!availableStrategies().some((strategy) => strategy.id === state.cloningDesign.strategy)) {
      state.cloningDesign.strategy = getCloningDesignSource()?.defaultStrategy || STRATEGY_WHOLE_PLASMID;
    }
    return state.cloningDesign;
  }

  function normalizeRangeForCurrentSource(source = getCloningDesignSource(), record = getSelectedRecord()) {
    const designState = getDesignState();
    const sequenceLength = normalizeSequenceText(record?.sequence || source?.editedSequence || '').length;
    if (!sequenceLength) {
      return { start: 0, end: 0 };
    }

    const defaultRange = deriveDefaultInsertRange(record, source);
    let start = Number.isFinite(Number(designState.insertStart))
      ? Math.round(Number(designState.insertStart))
      : defaultRange.start;
    let end = Number.isFinite(Number(designState.insertEnd))
      ? Math.round(Number(designState.insertEnd))
      : defaultRange.end;

    start = clamp(start, 0, Math.max(0, sequenceLength - 1));
    end = clamp(end, start + 1, sequenceLength);

    const editStart = clamp(getEditStartIndex(source), 0, sequenceLength - 1);
    const editEnd = clamp(Math.max(editStart + 1, getEditEndIndex(source)), editStart + 1, sequenceLength);
    start = Math.min(start, editStart);
    end = Math.max(end, editEnd);

    designState.insertStart = start;
    designState.insertEnd = end;
    if (elements.cloningDesignInsertStartInput) {
      elements.cloningDesignInsertStartInput.value = String(start + 1);
    }
    if (elements.cloningDesignInsertEndInput) {
      elements.cloningDesignInsertEndInput.value = String(end);
    }
    return { start, end };
  }

  function resetForSource(source = getCloningDesignSource(), record = getSelectedRecord()) {
    const designState = getDesignState();
    const sourceKey = buildSourceKey(source);
    if (designState.sourceKey === sourceKey) {
      return;
    }
    const defaultRange = deriveDefaultInsertRange(record, source);
    designState.sourceKey = sourceKey;
    designState.storedAgentDesign = null;
    designState.strategy = source?.defaultStrategy || STRATEGY_WHOLE_PLASMID;
    designState.insertStart = defaultRange.start;
    designState.insertEnd = defaultRange.end;
    // Vector Builder records which stored vector a replacement came from; that
    // vector is the PCR template, so the donor starts out already chosen.
    const seededDonorId = cleanText(source?.donorEntryId, 200);
    designState.donorEntryId = seededDonorId;
    resetDonor();
    donorReady = seededDonorId
      ? selectDonorEntry(seededDonorId, { silent: true })
      : Promise.resolve();
    designState.displayPlan = null;
    designState.notebookEntryId = source?.notebookEntryId || '';
  }

  function hasDesignSource() {
    const source = getCloningDesignSource();
    const record = getSelectedRecord();
    const editedSequence = normalizeSequenceText(source?.editedSequence || '');
    const currentSequence = normalizeSequenceText(record?.sequence || '');
    return Boolean(source?.editRequest && editedSequence.length && currentSequence && editedSequence === currentSequence);
  }

  function renderStrategyButtons() {
    if (!elements.cloningDesignStrategyList) {
      return;
    }
    const designState = getDesignState();
    elements.cloningDesignStrategyList.innerHTML = availableStrategies()
      .map((strategy) => `
        <button
          type="button"
          class="sequence-viewer-mode-btn${designState.strategy === strategy.id ? ' sequence-viewer-mode-btn-active' : ''}"
          data-cloning-design-strategy="${escapeHtml(strategy.id)}"
        >
          ${escapeHtml(strategy.label)}
        </button>
      `)
      .join('');
  }

  function renderEditSummary() {
    if (!elements.cloningDesignEditSummary) {
      return;
    }
    const source = getCloningDesignSource();
    if (!hasDesignSource()) {
      elements.cloningDesignEditSummary.innerHTML = '<p class="small-note">Edit the active sequence to start a cloning design.</p>';
      return;
    }
    const edit = source?.editRequest || {};
    const original = normalizeSequenceText(edit.originalSequence || '');
    const edited = normalizeSequenceText(edit.editedSequence || '');
    const start = Math.max(1, Number(edit.start) || 1);
    const end = Math.max(start, Number(edit.end) || start);
    elements.cloningDesignEditSummary.innerHTML = `
      <div class="sequence-viewer-cloning-design-edit-grid">
        <div><strong>Type</strong><span>${escapeHtml(formatEditType(edit.type))}</span></div>
        <div><strong>Range</strong><span>${start.toLocaleString()}..${end.toLocaleString()}</span></div>
        <div><strong>Original</strong><span class="sequence-viewer-cloning-design-seq">${escapeHtml(original || '-')}</span></div>
        <div><strong>Edited</strong><span class="sequence-viewer-cloning-design-seq">${escapeHtml(edited || '-')}</span></div>
      </div>
    `;
  }

  function renderPlanResult() {
    if (!elements.cloningDesignResult) {
      return;
    }
    const designState = getDesignState();
    const source = getCloningDesignSource();
    const record = getSelectedRecord();
    const range = normalizeRangeForCurrentSource(source, record);
    const displayPlan = designState.displayPlan;

    if (!hasDesignSource()) {
      elements.cloningDesignResult.innerHTML = '<p class="small-note">No sequence edit is available for primer design.</p>';
      return;
    }

    if (!displayPlan) {
      elements.cloningDesignResult.innerHTML = '<p class="small-note">Choose a route, then design primers.</p>';
      return;
    }

    const restrictionEnzymesHtml = renderRestrictionEnzymes(displayPlan);
    elements.cloningDesignResult.innerHTML = `
      <section class="sequence-viewer-cloning-design-result-section">
        <div class="result-card-head">
          <h4>Plan</h4>
        </div>
        ${renderPlanSummary(displayPlan, source, range)}
      </section>
      ${restrictionEnzymesHtml ? `
      <section class="sequence-viewer-cloning-design-result-section">
        <div class="result-card-head">
          <h4>Digestion Enzymes</h4>
        </div>
        ${restrictionEnzymesHtml}
      </section>` : ''}
      <section class="sequence-viewer-cloning-design-result-section">
        <div class="result-card-head">
          <h4>Primers</h4>
          ${isCloningDesignPlanActionable(displayPlan)
            ? '<button type="button" class="ghost-btn" data-cloning-design-action="order-primers">Order Primers</button>'
            : ''}
        </div>
        ${renderPrimerTable(asArray(displayPlan.primers))}
      </section>
      <section class="sequence-viewer-cloning-design-result-section">
        <div class="result-card-head">
          <h4>Procedure</h4>
        </div>
        ${renderProcedure(displayPlan)}
      </section>
      <section class="sequence-viewer-cloning-design-result-section">
        <div class="result-card-head">
          <h4>Warnings</h4>
        </div>
        ${renderWarnings(asArray(displayPlan.warnings))}
      </section>
    `;
  }

  function syncControls() {
    const designState = getDesignState();
    const hasSource = hasDesignSource();
    const usesRange = !designState.storedAgentDesign && !getCloningDesignSource()?.proteinBuilderDesign && cloningStrategyUsesInsertRange(designState.strategy);
    if (elements.cloningDesignRangePanel) {
      elements.cloningDesignRangePanel.hidden = !usesRange;
    }
    // Only insert routes amplify something that could come off another plasmid;
    // whole-plasmid and Q5/KLD are PCRs on this record by definition.
    const usesDonor = !designState.storedAgentDesign && !getCloningDesignSource()?.proteinBuilderDesign && cloningStrategyUsesDonor(designState.strategy);
    if (elements.cloningDesignDonorPanel) {
      elements.cloningDesignDonorPanel.hidden = !usesDonor;
    }
    if (elements.cloningDesignRunBtn) {
      elements.cloningDesignRunBtn.disabled = Boolean(designState.storedAgentDesign) || !hasSource || isDonorHydrationPending() || confirmPending;
    }
    if (elements.cloningDesignConfirmBtn) {
      // Nothing to commit until a feasible plan with primers exists.
      elements.cloningDesignConfirmBtn.disabled = Boolean(designState.storedAgentDesign) || confirmPending
        || !hasSource
        || !isCloningDesignPlanActionable(designState.displayPlan);
      elements.cloningDesignConfirmBtn.textContent = confirmPending ? 'Confirming…' : 'Confirm Design';
    }
    if (elements.cloningDesignStatus) {
      elements.cloningDesignStatus.textContent = hasSource
        ? `${formatStrategyLabel(designState.strategy)} ready.`
        : 'Edit the active sequence to enable cloning design.';
      elements.cloningDesignStatus.classList.toggle('is-error', !hasSource);
    }
  }

  function render() {
    if (!hasDesignSource()) {
      renderStrategyButtons();
      renderEditSummary();
      renderDonorPanel();
      syncControls();
      renderPlanResult();
      return;
    }
    resetForSource();
    normalizeRangeForCurrentSource();
    renderStrategyButtons();
    renderEditSummary();
    renderDonorPanel();
    syncControls();
    renderPlanResult();
  }

  function designPrimers() {
    if (!hasDesignSource()) {
      setStatus('Edit the active sequence before opening cloning design.', true);
      render();
      return;
    }
    const source = getCloningDesignSource();
    const record = getSelectedRecord();
    const designState = getDesignState();
    const range = normalizeRangeForCurrentSource(source, record);
    const displayPlan = buildDisplayPlan({
      strategy: designState.strategy,
      source,
      record,
      range,
      donor: getActiveDonor()
    });
    designState.displayPlan = displayPlan;
    const primers = asArray(displayPlan?.primers);
    const primerCount = primers.length;
    let notebookResult = null;
    let notebookError = '';
    try {
      notebookResult = source?.proteinBuilderDesign ? (displayPlan.feasible ? createProteinBuilderCloningNotebookPage({
        state: appState, persist, createId, onNotebookEntriesChanged,
        entryId: designState.notebookEntryId,
        ...source.proteinBuilderDesign,
        assembledRecord: record,
        plan: displayPlan.plans[0]?.plan
      }) : null) : createSequenceViewerCloningDesignNotebookPage({
        state: appState,
        persist,
        createId,
        onNotebookEntriesChanged,
        entryId: designState.notebookEntryId,
        source,
        record,
        displayPlan
      });
      if (notebookResult?.entry?.id) {
        designState.notebookEntryId = notebookResult.entry.id;
      }
    } catch (error) {
      notebookError = cleanText(error?.message || error, 400) || 'Unknown persistence error';
    }
    const notebookStatus = notebookResult?.entry
      ? ` Saved Notebook page “${notebookResult.entry.experimentName}”.`
      : (notebookError ? ` The Notebook page could not be saved: ${notebookError}.` : '');
    setStatus(
      `${formatStrategyLabel(designState.strategy)} designed ${primerCount.toLocaleString()} primer${primerCount === 1 ? '' : 's'}.${notebookStatus}`,
      !displayPlan?.feasible || Boolean(notebookError)
    );
    render();
    if (isCloningDesignPlanActionable(displayPlan)) {
      void annotatePrimersOnSelectedRecord({
        state,
        primers,
        target: 'product',
        persistFeatureMutation,
        label: `Annotated ${formatStrategyLabel(designState.strategy)} primers on the sequence.`
      });
    }
  }

  async function confirmDesign() {
    const designState = getDesignState();
    const primers = asArray(designState.displayPlan?.primers);
    if (confirmPending || !isCloningDesignPlanActionable(designState.displayPlan)) {
      setStatus('Generate a feasible, complete primer design before confirming it.', true);
      return null;
    }
    confirmPending = true;
    syncControls();
    const confirmedRecord = getSelectedRecord();
    const confirmedSource = getCloningDesignSource();
    const confirmedIndex = state.selectedRecordIndex;
    try {
      const result = await confirmCloningDesign({
        record: confirmedRecord,
        source: confirmedSource,
        primers,
        bridge: getBridge(),
        storagePath: getStoragePath()
      });
      // Disk writes may finish after the user has opened another record. The
      // saved product must not replace that record or steal its library ID.
      if (getSelectedRecord() !== confirmedRecord || state.selectedRecordIndex !== confirmedIndex
        || getCloningDesignSource() !== confirmedSource) {
        return result;
      }
      // The product record came back carrying the primer annotations, so it
      // replaces the working copy before anything re-renders.
      const records = asArray(state.records);
      const index = clamp(state.selectedRecordIndex, 0, Math.max(0, records.length - 1));
      if (records[index]) {
        state.records = records.map((entry, position) => (position === index ? result.productRecord : entry));
        state.selectedFeatureIndex = -1;
      }
      await onDesignConfirmed(result);
      if (confirmedSource?.proteinBuilderDesign) onReturnToDetail();
      setStatus(describeCloningDesignConfirmation(result), result.templates.some((template) => template.error || template.unplaced.length));
      return result;
    } catch (error) {
      setStatus(error?.message || 'Failed to confirm the design.', true);
      return null;
    } finally {
      confirmPending = false;
      syncControls();
    }
  }

  function storedDisplayPlan(design, method) {
    const route = design.routes?.find(r => r.method === method);
    return {
      strategy: method, feasible: Boolean(route?.feasible),
      primers: (route?.stages || []).flatMap(stage => (stage.primers || []).map(p => ({ ...p, groupLabel: `Stage ${stage.stage}: ${p.groupLabel || ''}` }))),
      plans: (route?.stages || []).flatMap(stage => stage.plans || []),
      warnings: [...(design.warnings || []), ...(route?.stages || []).flatMap(stage => stage.warnings || []), ...(!route ? ['This route was not evaluated.'] : [])],
      summary: route?.stages?.at(-1)?.summary || {}
    };
  }
  function openStoredPlan(design) {
    resetForSource();
    const designState = getDesignState();
    designState.storedAgentDesign = design;
    designState.strategy = design.recommended_method || design.routes?.[0]?.method || STRATEGY_WHOLE_PLASMID;
    designState.displayPlan = storedDisplayPlan(design, designState.strategy);
    onNavigateCloningDesign();
    render();
    return true;
  }
  function open() {
    if (!hasDesignSource()) {
      setStatus('Edit the active sequence before opening cloning design.', true);
      render();
      return false;
    }
    resetForSource();
    onNavigateCloningDesign();
    render();
    void donorReady.then(() => {
      if (!getDesignState().displayPlan) {
        designPrimers();
      }
    });
    return true;
  }

  function bindEvents() {
    elements.cloningDesignBackBtn?.addEventListener('click', (event) => {
      event.preventDefault();
      onReturnToDetail();
    });

    elements.cloningDesignStrategyList?.addEventListener('click', (event) => {
      const strategyId = cleanText(
        event?.target?.closest?.('[data-cloning-design-strategy]')?.dataset?.cloningDesignStrategy,
        80
      );
      if (!availableStrategies().some((strategy) => strategy.id === strategyId)) {
        return;
      }
      const designState = getDesignState();
      if (designState.strategy !== strategyId) {
        designState.strategy = strategyId;
        designState.displayPlan = designState.storedAgentDesign ? storedDisplayPlan(designState.storedAgentDesign, strategyId) : null;
      }
      render();
    });

    const handleRangeInput = () => {
      const designState = getDesignState();
      designState.insertStart = Math.max(0, Math.round(Number(elements.cloningDesignInsertStartInput?.value) || 1) - 1);
      designState.insertEnd = Math.max(1, Math.round(Number(elements.cloningDesignInsertEndInput?.value) || 1));
      designState.displayPlan = null;
      render();
    };

    elements.cloningDesignDonorSelect?.addEventListener('change', () => {
      void selectDonorEntry(cleanText(elements.cloningDesignDonorSelect?.value, 200));
    });

    elements.cloningDesignInsertStartInput?.addEventListener('change', handleRangeInput);
    elements.cloningDesignInsertEndInput?.addEventListener('change', handleRangeInput);

    elements.cloningDesignRunBtn?.addEventListener('click', (event) => {
      event.preventDefault();
      designPrimers();
    });

    elements.cloningDesignConfirmBtn?.addEventListener('click', (event) => {
      event.preventDefault();
      void confirmDesign();
    });

    elements.cloningDesignResult?.addEventListener('click', (event) => {
      if (event?.target?.closest?.('[data-cloning-design-action="order-primers"]')) {
        event.preventDefault();
        const displayPlan = getDesignState().displayPlan;
        if (isCloningDesignPlanActionable(displayPlan)) {
          onRequestPrimerOrder(asArray(displayPlan.primers));
        } else {
          setStatus('Generate a feasible, complete primer design before ordering primers.', true);
        }
        return;
      }
      void (async () => {
        const result = await copyPrimerValueFromEvent(event);
        if (!result.handled) {
          return;
        }
        const label = result.kind === 'sequence' ? 'primer sequence' : 'primer name';
        setStatus(
          result.copied
            ? `Copied ${label}.`
            : `Clipboard access is unavailable. Copy the ${label} directly from the table.`,
          !result.copied
        );
      })();
    });
  }

  return {
    bindEvents,
    confirmDesign,
    designPrimers,
    hasDesignSource,
    openStoredPlan,
    isOpen: () => isVisibleElement(elements.cloningDesignWorkspace),
    open,
    render,
    syncControls
  };
}

export {
  cloningStrategyUsesInsertRange,
  cloningStrategyUsesDonor,
  isCloningDesignPlanActionable
} from './cloning-design/strategies.js';
export { buildDisplayPlan } from './cloning-design/plan-building.js';
