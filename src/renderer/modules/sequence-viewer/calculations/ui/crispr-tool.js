import { createPresentation } from "../../../../lib/i18n/presentation.js";
import "../../localization.js";
const i18nUi = createPresentation("dna");
import { escapeHtml } from '../../../../lib/html.js';
import { clampNumber } from '../../../../lib/numbers.js';
import { renderPrimerCopyButton, copyPrimerValueFromEvent } from '../../primer-copy.js';
import {
  normalizeIupacPattern,
  parseCrisprTargetsInput,
  designCrisprGuides,
  buildCrisprGuideTsv
} from '../crispr.js';
import { showTransientNotice } from '../../../../lib/notify.js';

function formatPercent(value, digits = 1) {
  if (!Number.isFinite(value)) {
    return 'n/a';
  }
  return `${Number(value).toFixed(digits)}%`;
}

export function initCrisprTool(options = {}) {
  const rootDocument = options?.document || globalThis?.document || null;
  if (!rootDocument) {
    return;
  }

  const crisprForm = rootDocument.getElementById('crispr-form');
  const crisprPamPatternSelect = rootDocument.getElementById('crispr-pam-pattern');
  const crisprGuideLengthInput = rootDocument.getElementById('crispr-guide-length');
  const crisprTopCountInput = rootDocument.getElementById('crispr-top-count');
  const crisprMinGcInput = rootDocument.getElementById('crispr-min-gc');
  const crisprMaxGcInput = rootDocument.getElementById('crispr-max-gc');
  const crisprTargetInput = rootDocument.getElementById('crispr-target-input');
  const crisprTargetSelect = rootDocument.getElementById('crispr-target-select');
  const crisprSelectionSummary = rootDocument.getElementById('crispr-selection-summary');
  const crisprSelectAllBtn = rootDocument.getElementById('crispr-select-all-btn');
  const crisprClearBtn = rootDocument.getElementById('crispr-clear-btn');
  const crisprResultSummary = rootDocument.getElementById('crispr-result-summary');
  const crisprTableBody = rootDocument.getElementById('crispr-table-body');
  const crisprRunBtn = rootDocument.getElementById('crispr-run-btn');
  const crisprCopyTsvBtn = rootDocument.getElementById('crispr-copy-tsv-btn');

  if (!crisprForm || !crisprTargetInput || !crisprTargetSelect || !crisprTableBody) {
    return;
  }

  const crisprState = {
    targets: [],
    candidates: []
  };
  let parseDebounceId = null;

  function setCrisprCandidates(candidates = []) {
    crisprState.candidates = candidates;
    if (crisprCopyTsvBtn) {
      crisprCopyTsvBtn.disabled = !candidates.length;
    }
  }

  function setCrisprTableMessage(message = 'No sgRNA candidates yet.') {
    setCrisprCandidates([]);
    i18nUi.setHtml(crisprTableBody, `
      <tr>
        <td colspan="12" class="small-note">${escapeHtml(message)}</td>
      </tr>
    `);
  }

  function getSelectedCrisprTargets() {
    const selectedIds = new Set(
      [...crisprTargetSelect.selectedOptions].map((option) => option.value)
    );
    return crisprState.targets.filter((target) => selectedIds.has(target.id));
  }

  function renderCrisprSelectionSummary() {
    if (!crisprSelectionSummary) {
      return;
    }

    if (!crisprState.targets.length) {
      i18nUi.setText(crisprSelectionSummary, i18nUi.message("Add target sequences to begin."));
      return;
    }

    const selectedTargets = getSelectedCrisprTargets();
    const totalBases = selectedTargets.reduce((sum, target) => sum + target.sequence.length, 0);
    const shortest = selectedTargets.length
      ? Math.min(...selectedTargets.map((target) => target.sequence.length))
      : 0;
    const longest = selectedTargets.length
      ? Math.max(...selectedTargets.map((target) => target.sequence.length))
      : 0;

    i18nUi.setHtml(crisprSelectionSummary, `
      <p><strong>${i18nUi.html("Targets loaded:")}</strong> ${crisprState.targets.length}</p>
      <p><strong>${i18nUi.html("Targets selected:")}</strong> ${selectedTargets.length}</p>
      <p><strong>${i18nUi.html("Total selected length:")}</strong> ${totalBases.toLocaleString()} bp</p>
      <p><strong>${i18nUi.html("Length range:")}</strong> ${shortest.toLocaleString()}-${longest.toLocaleString()} bp</p>
      <p class="small-note">${i18nUi.html("Tip: Use FASTA headers to name each target sequence.")}</p>
    `);
  }

  function refreshCrisprTargets(selectAll = false) {
    const previousSelection = new Set(
      [...crisprTargetSelect.selectedOptions].map((option) => option.value)
    );
    const hadPreviousSelection = previousSelection.size > 0;
    crisprState.targets = parseCrisprTargetsInput(crisprTargetInput.value);

    if (!crisprState.targets.length) {
      i18nUi.setHtml(crisprTargetSelect, `<option value="" disabled data-i18n="dna.full.73883839">${i18nUi.text("No targets parsed.")}</option>`);
      renderCrisprSelectionSummary();
      return;
    }

    const optionsMarkup = crisprState.targets.map((target) => {
      const shouldSelect = selectAll || !hadPreviousSelection || previousSelection.has(target.id);
      const selectedAttr = shouldSelect ? ' selected' : '';
      return `<option value="${target.id}"${selectedAttr}>${escapeHtml(target.name)} (${target.sequence.length.toLocaleString()} bp)</option>`;
    }).join('');
    i18nUi.setHtml(crisprTargetSelect, optionsMarkup);
    renderCrisprSelectionSummary();
  }

  function renderCrisprDesignResults(result, context) {
    const { guideLength, pamPattern } = context;
    const warnings = [];
    if (result.truncatedCandidates) {
      warnings.push('Only the highest on-target guides were fully off-target scored for performance.');
    }
    if (result.truncatedBackground) {
      warnings.push('Off-target scanning used a truncated background window set.');
    }

    if (!result.candidates.length) {
      const noCandidateMessage = result.totalPamMatches > 0
        ? 'No candidates passed current GC and scoring filters. Try widening GC range or using a different PAM.'
        : 'No PAM-matching guides were found for the selected targets.';
      if (crisprResultSummary) {
        i18nUi.setHtml(crisprResultSummary, `
          <p><strong>${i18nUi.html("PAM:")}</strong> ${escapeHtml(pamPattern)} | <strong>${i18nUi.html("Guide length:")}</strong> ${guideLength} nt</p>
          <p><strong>${i18nUi.html("PAM-matching guides:")}</strong> ${result.totalPamMatches.toLocaleString()}</p>
          <p class="small-note">${escapeHtml(noCandidateMessage)}</p>
        `);
      }
      setCrisprTableMessage(noCandidateMessage);
      return;
    }

    const tableRows = result.candidates.map((candidate, index) => {
      const offTargetRate = candidate.offTargetRate;
      const riskClass = offTargetRate <= 10
        ? 'crispr-risk-low'
        : (offTargetRate <= 30 ? 'crispr-risk-medium' : 'crispr-risk-high');
      const notes = candidate.notes.length ? candidate.notes.join(', ') : '-';
      return `
        <tr>
          <td>${index + 1}</td>
          <td>${escapeHtml(candidate.targetName)}</td>
          <td>${candidate.start.toLocaleString()}-${candidate.end.toLocaleString()}</td>
          <td>${candidate.strand}</td>
          <td><span class="crispr-guide-seq">${escapeHtml(candidate.guideSequence)}</span>${renderPrimerCopyButton(candidate.guideSequence, 'sequence', 'guide sequence')}</td>
          <td><span class="crispr-guide-seq">${escapeHtml(candidate.pamSequence)}</span></td>
          <td>${candidate.gcPercent.toFixed(1)}%</td>
          <td>${candidate.onTargetScore.toFixed(1)}</td>
          <td><span class="crispr-risk-badge ${riskClass}">${formatPercent(offTargetRate, 2)}</span></td>
          <td>${candidate.totalScore.toFixed(1)}</td>
          <td>${candidate.mismatchCounts.exact}/${candidate.mismatchCounts.mismatch1}/${candidate.mismatchCounts.mismatch2}/${candidate.mismatchCounts.mismatch3}</td>
          <td>${escapeHtml(notes)}</td>
        </tr>
      `;
    }).join('');

    i18nUi.setHtml(crisprTableBody, tableRows);
    setCrisprCandidates(result.candidates);

    if (crisprResultSummary) {
      i18nUi.setHtml(crisprResultSummary, `
        <p><strong>${i18nUi.html("PAM:")}</strong> ${escapeHtml(pamPattern)} | <strong>${i18nUi.html("Guide length:")}</strong> ${guideLength} nt</p>
        <p><strong>${i18nUi.html("Guides evaluated:")}</strong> ${result.evaluatedCandidateCount.toLocaleString()} / ${result.filteredCandidateCount.toLocaleString()} ${i18nUi.html("filtered candidates (")}${result.totalPamMatches.toLocaleString()} ${i18nUi.html("PAM-matching guides detected)")}</p>
        <p><strong>${i18nUi.html("Background sites scanned:")}</strong> ${result.scannedBackgroundSiteCount.toLocaleString()} / ${result.backgroundSiteCount.toLocaleString()}</p>
        ${warnings.map((warning) => `<p class="small-note">${escapeHtml(warning)}</p>`).join('')}
      `);
    }
  }

  async function runCrisprDesign() {
    const selectedTargets = getSelectedCrisprTargets();
    if (!selectedTargets.length) {
      if (crisprResultSummary) {
        i18nUi.setText(crisprResultSummary, i18nUi.message("Select at least one target sequence to design sgRNAs."));
      }
      setCrisprTableMessage('Select at least one target sequence to design sgRNAs.');
      return;
    }

    if (crisprRunBtn) {
      crisprRunBtn.disabled = true;
      i18nUi.setText(crisprRunBtn, i18nUi.message("Designing..."));
    }
    // The scan is synchronous, so yield one tick to let the busy label paint before it blocks.
    await new Promise((resolve) => { setTimeout(resolve, 0); });

    try {
      designAndRenderCrispr(selectedTargets);
    } catch (error) {
      const message = `Design failed: ${error?.message || 'unexpected error'}`;
      if (crisprResultSummary) {
        i18nUi.setText(crisprResultSummary, message);
      }
      setCrisprTableMessage(message);
    } finally {
      if (crisprRunBtn) {
        crisprRunBtn.disabled = false;
        i18nUi.setText(crisprRunBtn, i18nUi.message("Design sgRNAs"));
      }
    }
  }

  function designAndRenderCrispr(selectedTargets) {
    const guideLength = Math.round(clampNumber(crisprGuideLengthInput?.value, 18, 24, 20));
    const topCount = Math.round(clampNumber(crisprTopCountInput?.value, 1, 100, 12));
    let minGc = clampNumber(crisprMinGcInput?.value, 0, 100, 35);
    let maxGc = clampNumber(crisprMaxGcInput?.value, 0, 100, 75);
    if (minGc > maxGc) {
      [minGc, maxGc] = [maxGc, minGc];
    }

    const pamPattern = normalizeIupacPattern(crisprPamPatternSelect?.value || 'NGG');
    const result = designCrisprGuides({
      selectedTargets,
      backgroundTargets: crisprState.targets.length ? crisprState.targets : selectedTargets,
      guideLength,
      pamPattern,
      minGc,
      maxGc,
      topCount
    });

    renderCrisprDesignResults(result, {
      guideLength,
      pamPattern
    });
  }

  refreshCrisprTargets(true);
  setCrisprTableMessage('No sgRNA candidates yet.');

  // Debounced: re-parsing a large pasted FASTA on every keystroke makes typing lag.
  crisprTargetInput.addEventListener('input', () => {
    clearTimeout(parseDebounceId);
    parseDebounceId = setTimeout(() => {
      refreshCrisprTargets();
      if (!crisprTargetInput.value.trim()) {
        if (crisprResultSummary) {
          i18nUi.setText(crisprResultSummary, i18nUi.message("Enter target sequences and run design to view candidate guides."));
        }
        setCrisprTableMessage('No sgRNA candidates yet.');
      }
    }, 200);
  });

  crisprTableBody.addEventListener('click', (event) => {
    copyPrimerValueFromEvent(event, { navigatorRef: options?.navigatorRef });
  });

  crisprCopyTsvBtn?.addEventListener('click', async () => {
    if (!crisprState.candidates.length) {
      return;
    }
    const clipboard = options?.navigatorRef?.clipboard || globalThis.navigator?.clipboard;
    if (!clipboard?.writeText) {
      return;
    }
    try {
      await clipboard.writeText(buildCrisprGuideTsv(crisprState.candidates));
      i18nUi.setText(crisprCopyTsvBtn, i18nUi.message("Copied"));
      setTimeout(() => { i18nUi.setText(crisprCopyTsvBtn, i18nUi.message("Copy Results (TSV)")); }, 1500);
    } catch {
      i18nUi.setText(crisprCopyTsvBtn, i18nUi.message("Copy failed"));
      showTransientNotice(i18nUi.message("Could not copy the sgRNA table to the clipboard."), { type: 'error' });
      setTimeout(() => { i18nUi.setText(crisprCopyTsvBtn, i18nUi.message("Copy Results (TSV)")); }, 1500);
    }
  });

  crisprTargetSelect.addEventListener('change', () => {
    renderCrisprSelectionSummary();
  });

  crisprSelectAllBtn?.addEventListener('click', () => {
    refreshCrisprTargets(true);
  });

  crisprClearBtn?.addEventListener('click', () => {
    crisprTargetInput.value = '';
    crisprState.targets = [];
    i18nUi.setHtml(crisprTargetSelect, `<option value="" disabled data-i18n="dna.full.73883839">${i18nUi.text("No targets parsed.")}</option>`);
    renderCrisprSelectionSummary();
    if (crisprResultSummary) {
      i18nUi.setText(crisprResultSummary, i18nUi.message("Enter target sequences and run design to view candidate guides."));
    }
    setCrisprTableMessage('No sgRNA candidates yet.');
  });

  crisprForm.addEventListener('submit', (event) => {
    event.preventDefault();
    runCrisprDesign();
  });
}
