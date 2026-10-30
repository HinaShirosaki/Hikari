import { createPresentation } from "../../../lib/i18n/presentation.js";
import "../localization.js";
const i18nUi = createPresentation("dna");
import { escapeHtml } from '../../../lib/html.js';
import { getUniProtRegions, selectUniProtSequence } from './uniprot-model.js';

export function installProteinBuilderUniProtPicker(ctx) {
  const e = ctx.elements;
  let generation = 0;
  let items = [];
  let entry = null;
  let regions = [];
  let query = '';
  let nextCursor = '';
  let busy = false;
  let autoName = '';
  let manualDraft = null;
  let resultsCollapsed = false;

  ctx.isUniProtSource = () => e.proteinBuilderAddProteinSourceUniProt?.checked === true;

  function setStatus(message = '') {
    if (e.proteinBuilderUniProtStatus) {
      i18nUi.setOwnedText(e.proteinBuilderUniProtStatus, message);
      e.proteinBuilderUniProtStatus.hidden = !message;
    }
  }

  function syncControls() {
    if (e.proteinBuilderUniProtSearchBtn) e.proteinBuilderUniProtSearchBtn.disabled = busy;
    if (e.proteinBuilderUniProtMoreBtn) {
      e.proteinBuilderUniProtMoreBtn.hidden = !nextCursor || resultsCollapsed;
      e.proteinBuilderUniProtMoreBtn.disabled = busy;
    }
    if (e.proteinBuilderUniProtResultsToggleBtn) {
      e.proteinBuilderUniProtResultsToggleBtn.hidden = !entry || (items.length <= 1 && !nextCursor);
      i18nUi.setText(e.proteinBuilderUniProtResultsToggleBtn, (resultsCollapsed ? i18nUi.message("Show all results") : i18nUi.message("Show selected only")));
      e.proteinBuilderUniProtResultsToggleBtn.setAttribute?.('aria-expanded', String(!resultsCollapsed));
      e.proteinBuilderUniProtResultsToggleBtn.disabled = busy;
    }
    e.proteinBuilderUniProtPanel?.setAttribute?.('aria-busy', String(busy));
  }

  function clearEntry() {
    entry = null;
    resultsCollapsed = false;
    regions = [];
    autoName = '';
    if (e.proteinBuilderUniProtDetail) e.proteinBuilderUniProtDetail.hidden = true;
    if (ctx.isUniProtSource()) {
      if (e.proteinBuilderAddProteinName) e.proteinBuilderAddProteinName.value = '';
      if (e.proteinBuilderAddProteinSequence) e.proteinBuilderAddProteinSequence.value = '';
    }
  }

  function renderResults() {
    syncControls();
    if (!e.proteinBuilderUniProtResults) return;
    i18nUi.setHtml(e.proteinBuilderUniProtResults, items.map((item, index) => resultsCollapsed && item.accession !== entry?.accession ? '' : `
      <button type="button" class="sequence-viewer-protein-builder-uniprot-result" data-uniprot-result="${index}" aria-pressed="${item.accession === entry?.accession}">
        <strong>${escapeHtml(item.proteinName || item.entryId || item.accession)}</strong>
        <span class="small-note">${escapeHtml([
          item.accession, item.geneNames?.join(', '), item.organism?.scientificName,
          `${item.sequence?.length || item.sequence?.value?.length || 0} aa`,
          item.reviewed ? 'Reviewed' : 'Unreviewed'
        ].filter(Boolean).join(' · '))}</span>
      </button>`).join(''));
  }

  ctx.toggleUniProtResults = function toggleUniProtResults() {
    if (!entry) return;
    resultsCollapsed = !resultsCollapsed;
    renderResults();
  };

  ctx.getUniProtInput = function getUniProtInput() {
    const value = e.proteinBuilderUniProtRegion?.value || 'full';
    const region = value.startsWith('region-') ? regions[Number(value.slice(7))] : null;
    if (entry && value !== 'full' && !region?.selectable) {
      return { sequence: '', error: 'Choose a full sequence or an annotation with exact boundaries.' };
    }
    return selectUniProtSequence(entry, region?.start ?? 1, region?.end ?? entry?.sequence?.value?.length, region);
  };

  function applySelection() {
    const selection = ctx.getUniProtInput();
    if (e.proteinBuilderAddProteinSequence) e.proteinBuilderAddProteinSequence.value = selection.sequence;
    if (selection.label && e.proteinBuilderAddProteinName && (!e.proteinBuilderAddProteinName.value || e.proteinBuilderAddProteinName.value === autoName)) {
      e.proteinBuilderAddProteinName.value = selection.label;
    }
    autoName = selection.label || autoName;
    ctx.renderAddProteinDialog();
  }

  function showEntry(selected) {
    entry = selected;
    resultsCollapsed = true;
    regions = getUniProtRegions(entry);
    const length = entry.sequence.value.length;
    if (e.proteinBuilderUniProtSummary) {
      i18nUi.setText(e.proteinBuilderUniProtSummary, `${entry.accession} · ${entry.organism?.scientificName || 'Organism unspecified'} · ${length} aa`);
    }
    if (e.proteinBuilderUniProtRegion) {
      const options = regions.map((region, index) => `<option value="region-${index}"${region.selectable ? '' : ' disabled'}>${escapeHtml(`${region.type}${region.description ? `: ${region.description}` : ''} · ${region.start ?? '?'}–${region.end ?? '?'}${region.selectable ? '' : ' (uncertain boundary)'}`)}</option>`).join('');
      i18nUi.setHtml(e.proteinBuilderUniProtRegion, `<option value="full" data-i18n="dna.full.bf242c0c">${i18nUi.text("Full sequence · 1–")}${length}</option>${options}`);
      e.proteinBuilderUniProtRegion.value = 'full';
    }
    if (e.proteinBuilderUniProtDetail) e.proteinBuilderUniProtDetail.hidden = false;
    autoName = '';
    if (e.proteinBuilderAddProteinName) e.proteinBuilderAddProteinName.value = '';
    renderResults();
    applySelection();
    e.proteinBuilderUniProtResults?.querySelector?.('[aria-pressed="true"]')?.focus?.({ preventScroll: true });
  }

  ctx.cancelUniProtRequests = function cancelUniProtRequests() {
    generation += 1;
    busy = false;
    syncControls();
  };

  function applySourceUi(uniprot) {
    if (e.proteinBuilderUniProtPanel) e.proteinBuilderUniProtPanel.hidden = !uniprot;
    if (e.proteinBuilderAddProteinType) e.proteinBuilderAddProteinType.disabled = uniprot;
    const typeField = e.proteinBuilderAddProteinType?.closest?.('label');
    if (typeField) typeField.hidden = uniprot;
    e.proteinBuilderAddProteinForm?.classList?.toggle('is-uniprot', uniprot);
    if (e.proteinBuilderAddProteinSequence) e.proteinBuilderAddProteinSequence.readOnly = uniprot;
  }

  ctx.resetUniProtPicker = function resetUniProtPicker() {
    ctx.cancelUniProtRequests();
    items = [];
    nextCursor = '';
    query = '';
    manualDraft = null;
    if (e.proteinBuilderAddProteinSourceManual) e.proteinBuilderAddProteinSourceManual.checked = true;
    if (e.proteinBuilderAddProteinSourceUniProt) e.proteinBuilderAddProteinSourceUniProt.checked = false;
    if (e.proteinBuilderUniProtQuery) e.proteinBuilderUniProtQuery.value = '';
    applySourceUi(false);
    clearEntry();
    renderResults();
    setStatus();
    syncControls();
  };

  ctx.setAddProteinSource = function setAddProteinSource() {
    const uniprot = ctx.isUniProtSource();
    ctx.cancelUniProtRequests();
    applySourceUi(uniprot);
    if (uniprot) {
      manualDraft = {
        name: e.proteinBuilderAddProteinName?.value || '',
        type: e.proteinBuilderAddProteinType?.value || 'protein',
        sequence: e.proteinBuilderAddProteinSequence?.value || ''
      };
      if (e.proteinBuilderAddProteinType) e.proteinBuilderAddProteinType.value = 'protein';
      if (e.proteinBuilderAddProteinName) e.proteinBuilderAddProteinName.value = '';
      applySelection();
    } else {
      if (manualDraft) {
        if (e.proteinBuilderAddProteinName) e.proteinBuilderAddProteinName.value = manualDraft.name;
        if (e.proteinBuilderAddProteinType) e.proteinBuilderAddProteinType.value = manualDraft.type;
        if (e.proteinBuilderAddProteinSequence) e.proteinBuilderAddProteinSequence.value = manualDraft.sequence;
      }
      ctx.renderAddProteinDialog();
    }
  };

  ctx.searchUniProt = async function searchUniProt(append = false) {
    const requestedQuery = String(e.proteinBuilderUniProtQuery?.value || '').trim();
    if (!ctx.isUniProtSource() || busy) return;
    if (!requestedQuery) {
      setStatus(i18nUi.text("Enter a UniProt query."));
      return;
    }
    const bridge = ctx.getBridge?.();
    if (!bridge?.searchUniProt) {
      setStatus(i18nUi.text("UniProt search is unavailable in this environment."));
      return;
    }
    const more = append && requestedQuery === query && Boolean(nextCursor);
    const token = ++generation;
    if (!more) {
      items = [];
      nextCursor = '';
      clearEntry();
      renderResults();
      ctx.renderAddProteinDialog();
    }
    query = requestedQuery;
    busy = true;
    syncControls();
    setStatus(i18nUi.text("Searching UniProt…"));
    try {
      const response = await bridge.searchUniProt({ query, size: 10, ...(more ? { cursor: nextCursor } : {}) });
      if (token !== generation) return;
      if (!response?.ok) throw new Error(response?.error || 'UniProt search failed. Try again.');
      const found = Array.isArray(response.result?.items) ? response.result.items : [];
      const seen = new Set(items.map((item) => item.accession));
      items = [...items, ...found.filter((item) => item.accession && !seen.has(item.accession))];
      nextCursor = response.result?.nextCursor || '';
      renderResults();
      setStatus((((((items.length ? '' : i18nUi.text("No proteins matched. Try a gene name, accession, or a different organism.")))))));
    } catch (error) {
      if (token === generation) setStatus((((((error?.message || i18nUi.text("UniProt search failed. Try again.")))))));
    } finally {
      if (token === generation) {
        busy = false;
        syncControls();
      }
    }
  };

  ctx.selectUniProtResult = async function selectUniProtResult(index) {
    const selected = items[index];
    if (!selected || !ctx.isUniProtSource()) return;
    const token = ++generation;
    busy = false;
    clearEntry();
    renderResults();
    ctx.renderAddProteinDialog();
    try {
      let protein = selected;
      if (!protein.sequence?.value) {
        busy = true;
        syncControls();
        setStatus(i18nUi.text("Loading UniProt sequence…"));
        const response = await ctx.getBridge?.()?.getUniProtEntry?.(selected.accession);
        if (token !== generation) return;
        if (!response?.ok) throw new Error(response?.error || 'Unable to load this UniProt protein.');
        protein = response.result?.entry;
      }
      if (!protein?.sequence?.value) throw new Error('This UniProt entry has no amino-acid sequence.');
      items[index] = protein;
      showEntry(protein);
      setStatus(`${protein.proteinName || protein.entryId || protein.accession} · ${protein.reviewed ? 'Reviewed' : 'Unreviewed'}`);
    } catch (error) {
      if (token === generation) setStatus((((((error?.message || i18nUi.text("Unable to load this UniProt protein.")))))));
    } finally {
      if (token === generation) {
        busy = false;
        syncControls();
      }
    }
  };

  ctx.bindUniProtEvents = function bindUniProtEvents() {
    e.proteinBuilderAddProteinSource?.addEventListener('change', ctx.setAddProteinSource);
    e.proteinBuilderUniProtSearchBtn?.addEventListener('click', () => { void ctx.searchUniProt(); });
    e.proteinBuilderUniProtMoreBtn?.addEventListener('click', () => { void ctx.searchUniProt(true); });
    e.proteinBuilderUniProtResultsToggleBtn?.addEventListener('click', ctx.toggleUniProtResults);
    e.proteinBuilderUniProtQuery?.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      void ctx.searchUniProt();
    });
    e.proteinBuilderUniProtResults?.addEventListener('click', (event) => {
      const button = event.target?.closest?.('[data-uniprot-result]');
      if (button) void ctx.selectUniProtResult(Number(button.dataset.uniprotResult));
    });
    e.proteinBuilderUniProtRegion?.addEventListener('change', () => {
      if (!entry) return;
      applySelection();
    });
  };
}
