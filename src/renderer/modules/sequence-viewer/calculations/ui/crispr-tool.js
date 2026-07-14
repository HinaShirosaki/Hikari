import { escapeHtml } from '../../../../lib/html.js';
import { clampNumber } from '../../../../lib/numbers.js';
import {
  CRISPR_REFERENCE_GENOMES,
  normalizeIupacPattern,
  parseCrisprTargetsInput,
  designCrisprGuides
} from '../crispr.js';

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
  const crisprReferenceGenomeSelect = rootDocument.getElementById('crispr-reference-genome');
  const crisprReferenceNote = rootDocument.getElementById('crispr-reference-note');
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

  if (!crisprForm || !crisprTargetInput || !crisprTargetSelect || !crisprTableBody) {
    return;
  }

  const crisprState = {
    targets: []
  };

  function setCrisprTableMessage(message = 'No sgRNA candidates yet.') {
    crisprTableBody.innerHTML = `
      <tr>
        <td colspan="12" class="small-note">${escapeHtml(message)}</td>
      </tr>
    `;
  }

  function getSelectedCrisprReferenceGenome() {
    const fallback = CRISPR_REFERENCE_GENOMES[0];
    const selectedId = crisprReferenceGenomeSelect?.value || fallback.id;
    return CRISPR_REFERENCE_GENOMES.find((genome) => genome.id === selectedId) || fallback;
  }

  function updateCrisprReferenceNote() {
    if (!crisprReferenceNote) {
      return;
    }
    const genome = getSelectedCrisprReferenceGenome();
    crisprReferenceNote.textContent = genome?.note || 'Reference genome profile not selected.';
  }

  function populateCrisprReferenceGenomeOptions() {
    if (!crisprReferenceGenomeSelect || !CRISPR_REFERENCE_GENOMES.length) {
      return;
    }

    const current = crisprReferenceGenomeSelect.value;
    crisprReferenceGenomeSelect.innerHTML = CRISPR_REFERENCE_GENOMES
      .map((genome) => `<option value="${genome.id}">${escapeHtml(genome.label)}</option>`)
      .join('');

    if (current && CRISPR_REFERENCE_GENOMES.some((genome) => genome.id === current)) {
      crisprReferenceGenomeSelect.value = current;
    } else {
      crisprReferenceGenomeSelect.value = CRISPR_REFERENCE_GENOMES[0].id;
    }

    updateCrisprReferenceNote();
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
      crisprSelectionSummary.textContent = 'Add target sequences to begin.';
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

    crisprSelectionSummary.innerHTML = `
      <p><strong>Targets loaded:</strong> ${crisprState.targets.length}</p>
      <p><strong>Targets selected:</strong> ${selectedTargets.length}</p>
      <p><strong>Total selected length:</strong> ${totalBases.toLocaleString()} bp</p>
      <p><strong>Length range:</strong> ${shortest.toLocaleString()}-${longest.toLocaleString()} bp</p>
      <p class="small-note">Tip: Use FASTA headers to name each target sequence.</p>
    `;
  }

  function refreshCrisprTargets(selectAll = false) {
    const previousSelection = new Set(
      [...crisprTargetSelect.selectedOptions].map((option) => option.value)
    );
    const hadPreviousSelection = previousSelection.size > 0;
    crisprState.targets = parseCrisprTargetsInput(crisprTargetInput.value);

    if (!crisprState.targets.length) {
      crisprTargetSelect.innerHTML = '<option value="" disabled>No targets parsed.</option>';
      renderCrisprSelectionSummary();
      return;
    }

    const optionsMarkup = crisprState.targets.map((target) => {
      const shouldSelect = selectAll || !hadPreviousSelection || previousSelection.has(target.id);
      const selectedAttr = shouldSelect ? ' selected' : '';
      return `<option value="${target.id}"${selectedAttr}>${escapeHtml(target.name)} (${target.sequence.length.toLocaleString()} bp)</option>`;
    }).join('');
    crisprTargetSelect.innerHTML = optionsMarkup;
    renderCrisprSelectionSummary();
  }

  function renderCrisprDesignResults(result, context) {
    const { guideLength, pamPattern, referenceGenome } = context;
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
        crisprResultSummary.innerHTML = `
          <p><strong>Reference genome:</strong> ${escapeHtml(referenceGenome.label)}</p>
          <p><strong>PAM:</strong> ${escapeHtml(pamPattern)} | <strong>Guide length:</strong> ${guideLength} nt</p>
          <p><strong>PAM-matching guides:</strong> ${result.totalPamMatches.toLocaleString()}</p>
          <p class="small-note">${escapeHtml(noCandidateMessage)}</p>
        `;
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
          <td><span class="crispr-guide-seq">${escapeHtml(candidate.guideSequence)}</span></td>
          <td><span class="crispr-guide-seq">${escapeHtml(candidate.pamSequence)}</span></td>
          <td>${candidate.gcPercent.toFixed(1)}%</td>
          <td>${candidate.onTargetScore.toFixed(1)}</td>
          <td><span class="crispr-risk-badge ${riskClass}">${formatPercent(offTargetRate, 2)}</span></td>
          <td>${candidate.specificityScore.toFixed(1)}</td>
          <td>${candidate.mismatchCounts.exact}/${candidate.mismatchCounts.mismatch1}/${candidate.mismatchCounts.mismatch2}/${candidate.mismatchCounts.mismatch3}</td>
          <td>${escapeHtml(notes)}</td>
        </tr>
      `;
    }).join('');

    crisprTableBody.innerHTML = tableRows;

    if (crisprResultSummary) {
      crisprResultSummary.innerHTML = `
        <p><strong>Reference genome:</strong> ${escapeHtml(referenceGenome.label)}</p>
        <p><strong>PAM:</strong> ${escapeHtml(pamPattern)} | <strong>Guide length:</strong> ${guideLength} nt</p>
        <p><strong>Guides evaluated:</strong> ${result.evaluatedCandidateCount.toLocaleString()} / ${result.filteredCandidateCount.toLocaleString()} filtered candidates (${result.totalPamMatches.toLocaleString()} PAM-matching guides detected)</p>
        <p><strong>Background sites scanned:</strong> ${result.scannedBackgroundSiteCount.toLocaleString()} / ${result.backgroundSiteCount.toLocaleString()}</p>
        ${warnings.map((warning) => `<p class="small-note">${escapeHtml(warning)}</p>`).join('')}
      `;
    }
  }

  function runCrisprDesign() {
    const selectedTargets = getSelectedCrisprTargets();
    if (!selectedTargets.length) {
      if (crisprResultSummary) {
        crisprResultSummary.textContent = 'Select at least one target sequence to design sgRNAs.';
      }
      setCrisprTableMessage('Select at least one target sequence to design sgRNAs.');
      return;
    }

    const referenceGenome = getSelectedCrisprReferenceGenome();
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
      topCount,
      genomeMultiplier: referenceGenome.offTargetMultiplier || 1
    });

    renderCrisprDesignResults(result, {
      guideLength,
      pamPattern,
      referenceGenome
    });
  }

  populateCrisprReferenceGenomeOptions();
  refreshCrisprTargets(true);
  setCrisprTableMessage('No sgRNA candidates yet.');

  crisprReferenceGenomeSelect?.addEventListener('change', () => {
    updateCrisprReferenceNote();
  });

  crisprTargetInput.addEventListener('input', () => {
    refreshCrisprTargets();
    if (!crisprTargetInput.value.trim()) {
      if (crisprResultSummary) {
        crisprResultSummary.textContent = 'Enter target sequences and run design to view candidate guides.';
      }
      setCrisprTableMessage('No sgRNA candidates yet.');
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
    crisprTargetSelect.innerHTML = '<option value="" disabled>No targets parsed.</option>';
    renderCrisprSelectionSummary();
    if (crisprResultSummary) {
      crisprResultSummary.textContent = 'Enter target sequences and run design to view candidate guides.';
    }
    setCrisprTableMessage('No sgRNA candidates yet.');
  });

  crisprForm.addEventListener('submit', (event) => {
    event.preventDefault();
    runCrisprDesign();
  });
}
