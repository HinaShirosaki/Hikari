import { escapeHtml } from '../tool-box/common.js';
import { assembleCloningPlan } from './cloning-assembly.js';
import { buildMegaprimerRestrictionPlan } from './cloning-assembly/megaprimer-restriction.js';
import { buildQ5KldPlan } from './cloning-assembly/q5-kld-mutagenesis.js';
import { buildGoldenGatePlan } from './cloning-assembly/golden-gate.js';
import { cleanText, clamp, normalizeSequenceText } from './shared.js';
import { copyPrimerValueFromEvent, renderPrimerCopyButton } from './primer-copy.js';

const STRATEGY_WHOLE_PLASMID = 'whole-plasmid';
const STRATEGY_Q5_KLD = 'q5-kld';
const STRATEGY_TWO_STEP_LIGATION = 'two-step-ligation';
const STRATEGY_GOLDEN_GATE = 'golden-gate';
const STRATEGY_GIBSON = 'gibson';
const STRATEGY_IN_FUSION = 'in-fusion';

const IN_FUSION_PROCEDURE = Object.freeze([
  { title: 'Linearize the vector', details: 'Linearize the backbone by PCR or a single restriction cut at the insertion point, then purify.' },
  { title: 'Amplify insert with 15 bp overlaps', details: "PCR the insert with primers whose 5' extensions match the flanking vector ends (the overlaps designed above)." },
  { title: 'In-Fusion reaction', details: 'Combine the linearized vector and insert with In-Fusion enzyme (15 min, 50 C); it fuses the homologous 15 bp ends.' },
  { title: 'Transform and screen', details: 'Transform competent cells and confirm both junctions by colony PCR and sequencing.' }
]);

const STRATEGIES = Object.freeze([
  {
    id: STRATEGY_WHOLE_PLASMID,
    label: 'Amplify Whole Plasmid',
    shortLabel: 'Whole plasmid PCR'
  },
  {
    id: STRATEGY_Q5_KLD,
    label: 'Q5 / KLD Site-Directed Mutagenesis',
    shortLabel: 'Q5/KLD SDM'
  },
  {
    id: STRATEGY_TWO_STEP_LIGATION,
    label: 'Two-Step PCR + Digestion Ligation',
    shortLabel: 'Two-step ligation'
  },
  {
    id: STRATEGY_GOLDEN_GATE,
    label: 'Golden Gate (Type IIS)',
    shortLabel: 'Golden Gate'
  },
  {
    id: STRATEGY_GIBSON,
    label: 'Gibson Assembly',
    shortLabel: 'Gibson assembly'
  },
  {
    id: STRATEGY_IN_FUSION,
    label: 'In-Fusion Cloning',
    shortLabel: 'In-Fusion'
  }
]);

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function formatNumber(value, digits = 1) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return '-';
  }
  return number.toFixed(digits);
}

function formatBp(value) {
  return `${Math.max(0, Number(value) || 0).toLocaleString()} bp`;
}

function formatPrimerRole(role) {
  return String(role || '')
    .trim()
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\b\w/g, (match) => match.toUpperCase()) || 'Primer';
}

function formatStrategyLabel(strategyId) {
  return STRATEGIES.find((strategy) => strategy.id === strategyId)?.shortLabel || 'Cloning design';
}

function formatEditType(type) {
  const normalized = String(type || '').trim().toLowerCase();
  if (normalized === 'point-mutation') {
    return 'point mutation';
  }
  if (normalized === 'insertion') {
    return 'insertion';
  }
  if (normalized === 'deletion') {
    return 'deletion';
  }
  if (normalized === 'replacement') {
    return 'replacement';
  }
  return normalized || 'sequence edit';
}

function buildSourceKey(source = {}) {
  const edit = source?.editRequest || {};
  return [
    cleanText(source?.recordName, 160),
    normalizeSequenceText(source?.editedSequence || '').length,
    cleanText(edit.type, 80),
    Math.max(0, Number(edit.start) || 0),
    Math.max(0, Number(edit.end) || 0),
    normalizeSequenceText(edit.originalSequence || ''),
    normalizeSequenceText(edit.editedSequence || '')
  ].join('|');
}

function getEditStartIndex(source = {}) {
  const rangeStart = Number(source?.editedRange?.start);
  if (Number.isFinite(rangeStart)) {
    return Math.max(0, Math.round(rangeStart));
  }
  const editStart = Number(source?.editRequest?.start);
  return Math.max(0, Number.isFinite(editStart) ? Math.round(editStart) - 1 : 0);
}

function getEditEndIndex(source = {}) {
  const rangeEnd = Number(source?.editedRange?.end);
  if (Number.isFinite(rangeEnd)) {
    return Math.max(getEditStartIndex(source), Math.round(rangeEnd));
  }
  const editedLength = normalizeSequenceText(source?.editRequest?.editedSequence || '').length;
  return getEditStartIndex(source) + Math.max(1, editedLength);
}

function getFeatureRangeContainingEdit(record = {}, source = {}) {
  const sequenceLength = normalizeSequenceText(record?.sequence || '').length;
  const editStart = getEditStartIndex(source);
  const editEnd = Math.max(editStart + 1, getEditEndIndex(source));
  const candidates = asArray(record?.features)
    .map((feature) => {
      const segments = asArray(feature?.segments)
        .map((segment) => ({
          start: clamp(Math.round(Number(segment?.start) || 0), 0, sequenceLength),
          end: clamp(Math.round(Number(segment?.end) || 0), 0, sequenceLength)
        }))
        .filter((segment) => segment.end > segment.start);
      if (!segments.length) {
        return null;
      }
      const start = Math.min(...segments.map((segment) => segment.start));
      const end = Math.max(...segments.map((segment) => segment.end));
      if (start > editStart || end < editEnd) {
        return null;
      }
      const type = cleanText(feature?.type, 120).toLowerCase();
      const priority = ['cds', 'insert', 'open_reading_frame', 'orf', 'misc_feature'].includes(type) ? 0 : 1;
      return {
        start,
        end,
        length: end - start,
        priority
      };
    })
    .filter(Boolean);

  if (!candidates.length) {
    return null;
  }

  candidates.sort((left, right) => {
    if (left.priority !== right.priority) {
      return left.priority - right.priority;
    }
    if (left.length !== right.length) {
      return left.length - right.length;
    }
    return left.start - right.start;
  });
  return candidates[0];
}

function deriveDefaultInsertRange(record = {}, source = {}) {
  const sequenceLength = normalizeSequenceText(record?.sequence || source?.editedSequence || '').length;
  if (!sequenceLength) {
    return { start: 0, end: 0 };
  }

  const featureRange = getFeatureRangeContainingEdit(record, source);
  if (featureRange) {
    return featureRange;
  }

  const editStart = clamp(getEditStartIndex(source), 0, sequenceLength);
  const editEnd = clamp(Math.max(editStart + 1, getEditEndIndex(source)), editStart + 1, sequenceLength);
  const minimumSpan = Math.min(sequenceLength, Math.max(120, editEnd - editStart));
  let start = Math.max(0, editStart - 120);
  let end = Math.min(sequenceLength, editEnd + 120);

  if (end - start < minimumSpan) {
    const extra = minimumSpan - (end - start);
    const leftExtra = Math.min(start, Math.floor(extra / 2));
    start -= leftExtra;
    end = Math.min(sequenceLength, end + extra - leftExtra);
    if (end - start < minimumSpan) {
      start = Math.max(0, start - (minimumSpan - (end - start)));
    }
  }

  return {
    start,
    end: Math.max(start + 1, end)
  };
}

function mapEditedIndexToOriginal(index, source = {}) {
  const safeIndex = Math.max(0, Math.round(Number(index) || 0));
  const editStart = getEditStartIndex(source);
  const originalLength = normalizeSequenceText(source?.editRequest?.originalSequence || '').length;
  const editedLength = normalizeSequenceText(source?.editRequest?.editedSequence || '').length;
  const editedEnd = editStart + editedLength;
  const delta = editedLength - originalLength;

  if (safeIndex <= editStart) {
    return safeIndex;
  }
  if (safeIndex >= editedEnd) {
    return Math.max(0, safeIndex - delta);
  }
  return editStart;
}

function extractOriginalTemplateForEditedRange(source = {}, start, end) {
  const originalSequence = normalizeSequenceText(source?.originalSequence || '');
  if (!originalSequence.length) {
    return '';
  }

  const originalStart = clamp(mapEditedIndexToOriginal(start, source), 0, originalSequence.length);
  let originalEnd = clamp(mapEditedIndexToOriginal(end, source), originalStart, originalSequence.length);
  if (originalEnd <= originalStart) {
    const editedSpan = Math.max(1, Math.round(Number(end) || 0) - Math.round(Number(start) || 0));
    originalEnd = clamp(originalStart + editedSpan, originalStart, originalSequence.length);
  }
  return originalSequence.slice(originalStart, originalEnd);
}

function buildLinearizedBackbone(sequence, start, end) {
  const cleaned = normalizeSequenceText(sequence || '');
  const sequenceLength = cleaned.length;
  if (!sequenceLength) {
    return '';
  }
  const safeStart = clamp(Math.round(Number(start) || 0), 0, sequenceLength);
  const safeEnd = clamp(Math.round(Number(end) || safeStart), safeStart, sequenceLength);
  return `${cleaned.slice(safeEnd)}${cleaned.slice(0, safeStart)}`;
}

function buildWholePlasmidPlan(source = {}, record = {}) {
  const templateSequence = normalizeSequenceText(source?.originalSequence || '');
  const resultSequence = normalizeSequenceText(record?.sequence || source?.editedSequence || '');
  if (!templateSequence.length || !resultSequence.length) {
    return null;
  }

  return assembleCloningPlan({
    hostVectors: [
      {
        id: 'edited_template_plasmid',
        name: cleanText(source?.recordName || record?.name, 160) || 'Template plasmid',
        topology: cleanText(record?.topology, 40).toLowerCase() === 'linear' ? 'linear' : 'circular',
        sequence: templateSequence
      }
    ],
    hostVectorId: 'edited_template_plasmid',
    fragments: [],
    resultSequence,
    editRequest: source?.editRequest,
    preferences: {
      allowRestrictionLigation: false,
      preferRestrictionLigation: false,
      preferGibsonForMultiFragment: false
    }
  });
}

function buildInsertAssemblyPlan(source = {}, record = {}, range = {}, strategy) {
  const sequence = normalizeSequenceText(record?.sequence || source?.editedSequence || '');
  const sequenceLength = sequence.length;
  if (!sequenceLength) {
    return null;
  }

  const start = clamp(Math.round(Number(range?.start) || 0), 0, sequenceLength - 1);
  const end = clamp(Math.round(Number(range?.end) || start + 1), start + 1, sequenceLength);
  const insertSequence = sequence.slice(start, end);
  const templateSequence = extractOriginalTemplateForEditedRange(source, start, end) || insertSequence;
  const backboneSequence = buildLinearizedBackbone(sequence, start, end);

  if (!insertSequence.length || !backboneSequence.length) {
    return null;
  }

  const isGibson = strategy === STRATEGY_GIBSON;
  return assembleCloningPlan({
    hostVectors: [
      {
        id: 'edited_linearized_backbone',
        name: `${cleanText(record?.name || source?.recordName, 120) || 'Vector'} backbone`,
        topology: 'linear',
        sequence: backboneSequence
      }
    ],
    hostVectorId: 'edited_linearized_backbone',
    fragments: [
      {
        id: 'edited_amplicon',
        name: 'Edited amplicon',
        type: 'insert',
        sequence: insertSequence,
        metadata: {
          source: 'sequence_viewer_edit',
          templateSequence
        }
      }
    ],
    resultSequence: sequence,
    preferences: isGibson
      ? {
          allowRestrictionLigation: false,
          preferRestrictionLigation: false,
          preferGibsonForMultiFragment: true
        }
      : {
          allowRestrictionLigation: true,
          preferRestrictionLigation: true,
          preferGibsonForMultiFragment: false
        }
  });
}

function planPrimers(plan = {}, groupLabel = '') {
  return asArray(plan?.primerOligoPlan?.primers).map((primer) => ({
    ...primer,
    groupLabel
  }));
}

function collectWarnings(...plans) {
  const warnings = [];
  plans.forEach((plan) => {
    asArray(plan?.warnings).forEach((warning) => {
      if (warning && !warnings.includes(warning)) {
        warnings.push(warning);
      }
    });
    asArray(plan?.primerOligoPlan?.warnings).forEach((warning) => {
      if (warning && !warnings.includes(warning)) {
        warnings.push(warning);
      }
    });
  });
  return warnings;
}

export function buildDisplayPlan({ strategy, source, record, range }) {
  if (strategy === STRATEGY_WHOLE_PLASMID) {
    const wholePlasmidPlan = buildWholePlasmidPlan(source, record);
    return {
      strategy,
      feasible: Boolean(wholePlasmidPlan?.feasible),
      plans: [{ label: 'Whole plasmid amplification', plan: wholePlasmidPlan }],
      primers: planPrimers(wholePlasmidPlan, 'Whole plasmid PCR'),
      warnings: collectWarnings(wholePlasmidPlan),
      summary: {
        templateLength: normalizeSequenceText(source?.originalSequence || '').length,
        resultLength: normalizeSequenceText(record?.sequence || source?.editedSequence || '').length
      }
    };
  }

  if (strategy === STRATEGY_Q5_KLD) {
    return {
      strategy,
      ...buildQ5KldPlan({
        originalSequence: source?.originalSequence,
        editedSequence: record?.sequence || source?.editedSequence,
        editRequest: source?.editRequest,
        recordName: source?.recordName || record?.name,
        topology: record?.topology
      })
    };
  }

  if (strategy === STRATEGY_TWO_STEP_LIGATION) {
    return {
      strategy,
      ...buildMegaprimerRestrictionPlan({
        originalSequence: source?.originalSequence,
        editedSequence: record?.sequence || source?.editedSequence,
        editRequest: source?.editRequest,
        recordName: source?.recordName || record?.name,
        topology: record?.topology
      })
    };
  }

  if (strategy === STRATEGY_GOLDEN_GATE) {
    return {
      strategy,
      ...buildGoldenGatePlan({
        sequence: record?.sequence || source?.editedSequence,
        range,
        recordName: source?.recordName || record?.name,
        topology: record?.topology
      })
    };
  }

  // In-Fusion reuses the Gibson homology-overlap primers; only the bench
  // procedure differs (one In-Fusion reaction vs. exonuclease + ligase).
  if (strategy === STRATEGY_IN_FUSION) {
    const inFusionAssembly = buildInsertAssemblyPlan(source, record, range, STRATEGY_GIBSON);
    const plan = inFusionAssembly
      ? { ...inFusionAssembly, stepByStepProcedure: IN_FUSION_PROCEDURE }
      : inFusionAssembly;
    return {
      strategy,
      feasible: Boolean(plan?.feasible),
      plans: [{ label: 'In-Fusion assembly', plan }],
      primers: planPrimers(plan, 'In-Fusion'),
      warnings: collectWarnings(plan),
      summary: {
        templateLength: normalizeSequenceText(source?.originalSequence || '').length,
        resultLength: normalizeSequenceText(record?.sequence || source?.editedSequence || '').length,
        insertLength: Math.max(0, Number(range?.end) - Number(range?.start))
      }
    };
  }

  const assemblyPlan = buildInsertAssemblyPlan(source, record, range, strategy);
  return {
    strategy,
    feasible: Boolean(assemblyPlan?.feasible),
    plans: [{ label: 'Gibson assembly', plan: assemblyPlan }],
    primers: planPrimers(assemblyPlan, 'Gibson assembly'),
    warnings: collectWarnings(assemblyPlan),
    summary: {
      templateLength: normalizeSequenceText(source?.originalSequence || '').length,
      resultLength: normalizeSequenceText(record?.sequence || source?.editedSequence || '').length,
      insertLength: Math.max(0, Number(range?.end) - Number(range?.start))
    }
  };
}

function renderPlanSummary(displayPlan = {}, source = {}, range = {}) {
  const edit = source?.editRequest || {};
  const summary = displayPlan?.summary || {};
  const rangeText = displayPlan.strategy === STRATEGY_WHOLE_PLASMID || displayPlan.strategy === STRATEGY_Q5_KLD
    ? 'whole plasmid'
    : `${(Math.max(0, Number(range?.start) || 0) + 1).toLocaleString()}..${Math.max(0, Number(range?.end) || 0).toLocaleString()}`;
  const planRows = asArray(displayPlan?.plans).map((entry) => {
    const plan = entry?.plan || {};
    const strategy = cleanText(plan?.recommendedAssemblyStrategy, 120)
      .replace(/[-_]+/g, ' ')
      || 'not feasible';
    const threshold = cleanText(plan?.primerOligoPlan?.selectedThresholdLevel, 80) || 'none';
    return `
      <div class="sequence-viewer-cloning-design-summary-row">
        <strong>${escapeHtml(entry?.label || 'Plan')}</strong>
        <span>${escapeHtml(strategy)} | threshold ${escapeHtml(threshold)}</span>
      </div>
    `;
  }).join('');

  return `
    <div class="sequence-viewer-cloning-design-plan-summary">
      <div class="sequence-viewer-cloning-design-summary-grid">
        <div><strong>Route</strong><span>${escapeHtml(formatStrategyLabel(displayPlan.strategy))}</span></div>
        <div><strong>Edit</strong><span>${escapeHtml(formatEditType(edit.type))}</span></div>
        <div><strong>Template</strong><span>${escapeHtml(formatBp(summary.templateLength))}</span></div>
        <div><strong>Final</strong><span>${escapeHtml(formatBp(summary.resultLength))}</span></div>
        <div><strong>Amplicon</strong><span>${escapeHtml(rangeText)}</span></div>
        <div><strong>Status</strong><span>${displayPlan.feasible ? 'Feasible' : 'Needs review'}</span></div>
      </div>
      ${planRows ? `<div class="sequence-viewer-cloning-design-summary-rows">${planRows}</div>` : ''}
    </div>
  `;
}

function renderPrimerTable(primers = []) {
  if (!primers.length) {
    return '<p class="small-note">No primer set was generated for this route.</p>';
  }

  return `
    <div class="sequence-viewer-cloning-design-primer-table-wrap">
      <table class="sequence-viewer-cloning-design-primer-table">
        <thead>
          <tr>
            <th>Step</th>
            <th>Primer</th>
            <th>Role</th>
            <th>Sequence</th>
            <th>Length</th>
            <th>Tm</th>
            <th>GC</th>
          </tr>
        </thead>
        <tbody>
          ${primers.map((primer, index) => {
            const sequence = normalizeSequenceText(primer?.sequence || '');
            const primerName = cleanText(primer?.name, 160) || `Primer ${index + 1}`;
            return `
              <tr>
                <td>${escapeHtml(cleanText(primer?.groupLabel, 120) || '-')}</td>
                <td>
                  <div class="sequence-viewer-primer-copy-cell">
                    <span class="sequence-viewer-primer-copy-value">${escapeHtml(primerName)}</span>
                    ${renderPrimerCopyButton(primerName, 'name', 'primer name')}
                  </div>
                </td>
                <td>${escapeHtml(formatPrimerRole(primer?.role))}</td>
                <td class="sequence-viewer-cloning-design-primer-seq">
                  <div class="sequence-viewer-primer-copy-cell sequence-viewer-primer-copy-cell-sequence">
                    <span class="sequence-viewer-primer-copy-value">${escapeHtml(sequence || '-')}</span>
                    ${renderPrimerCopyButton(sequence, 'sequence', 'primer sequence')}
                  </div>
                </td>
                <td>${Math.max(0, Number(primer?.length) || sequence.length).toLocaleString()} nt</td>
                <td>${escapeHtml(formatNumber(primer?.tm, 1))} C</td>
                <td>${escapeHtml(formatNumber(primer?.gcContent, 1))}%</td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function renderProcedure(displayPlan = {}) {
  const steps = [];
  asArray(displayPlan?.plans).forEach((entry) => {
    asArray(entry?.plan?.stepByStepProcedure).forEach((step) => {
      steps.push({
        group: cleanText(entry?.label, 120),
        title: cleanText(step?.title, 160),
        details: cleanText(step?.details, 800)
      });
    });
  });

  if (!steps.length) {
    return '<p class="small-note">No procedure steps were generated.</p>';
  }

  return `
    <ol class="sequence-viewer-cloning-design-procedure">
      ${steps.map((step) => `
        <li>
          <strong>${escapeHtml(step.title || step.group || 'Step')}</strong>
          <span>${escapeHtml(step.group ? `${step.group}: ${step.details}` : step.details)}</span>
        </li>
      `).join('')}
    </ol>
  `;
}

function renderRestrictionEnzymes(displayPlan = {}) {
  const enzymes = asArray(displayPlan?.plans)
    .map((entry) => asArray(entry?.plan?.restrictionEnzymeSelection))
    .find((selection) => selection.length) || [];
  if (!enzymes.length) {
    return '';
  }

  const rows = enzymes.map((enzyme) => {
    const name = cleanText(enzyme?.name, 80) || cleanText(enzyme?.site, 80) || 'enzyme';
    const recognition = cleanText(enzyme?.site, 80) || '-';
    const cut = cleanText(enzyme?.cut || asArray(enzyme?.cutPatterns)[0], 80);
    return `
      <li>
        <strong>${escapeHtml(name)}</strong>
        <span>recognition ${escapeHtml(recognition)}${cut ? ` | cut ${escapeHtml(cut)}` : ''}</span>
      </li>
    `;
  }).join('');

  return `
    <ul class="sequence-viewer-cloning-design-enzyme-list">${rows}</ul>
    <p class="small-note">Digest the backbone and the insert amplicon with this enzyme pair, then ligate.</p>
  `;
}

function renderWarnings(warnings = []) {
  if (!warnings.length) {
    return '<p class="small-note">No route warnings.</p>';
  }
  return warnings
    .map((warning) => `<p class="small-note sequence-viewer-cloning-design-warning">${escapeHtml(warning)}</p>`)
    .join('');
}

function isVisibleElement(element) {
  return Boolean(element && element.hidden !== true);
}

export function createSequenceViewerCloningDesignController(config = {}) {
  const elements = config?.elements || {};
  const state = config?.state || {};
  const getSelectedRecord = config?.getSelectedRecord || (() => null);
  const getCloningDesignSource = config?.getCloningDesignSource || (() => null);
  const setStatus = config?.setStatus || (() => {});
  const onNavigateCloningDesign = config?.onNavigateCloningDesign || (() => {});
  const onReturnToDetail = config?.onReturnToDetail || (() => {});

  function getDesignState() {
    if (!state.cloningDesign || typeof state.cloningDesign !== 'object') {
      state.cloningDesign = {};
    }
    if (!STRATEGIES.some((strategy) => strategy.id === state.cloningDesign.strategy)) {
      state.cloningDesign.strategy = STRATEGY_WHOLE_PLASMID;
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
    designState.strategy = STRATEGY_WHOLE_PLASMID;
    designState.insertStart = defaultRange.start;
    designState.insertEnd = defaultRange.end;
    designState.displayPlan = null;
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
    elements.cloningDesignStrategyList.innerHTML = STRATEGIES
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
    const usesRange = designState.strategy === STRATEGY_GIBSON
      || designState.strategy === STRATEGY_IN_FUSION
      || designState.strategy === STRATEGY_GOLDEN_GATE;
    if (elements.cloningDesignRangePanel) {
      elements.cloningDesignRangePanel.hidden = !usesRange;
    }
    if (elements.cloningDesignRunBtn) {
      elements.cloningDesignRunBtn.disabled = !hasSource;
    }
    if (elements.cloningDesignStatus) {
      elements.cloningDesignStatus.textContent = hasSource
        ? `${formatStrategyLabel(designState.strategy)} ready.`
        : 'Edit the active sequence to enable cloning design.';
      elements.cloningDesignStatus.style.color = hasSource ? '' : 'var(--theme-danger)';
    }
  }

  function render() {
    if (!hasDesignSource()) {
      renderStrategyButtons();
      renderEditSummary();
      syncControls();
      renderPlanResult();
      return;
    }
    resetForSource();
    normalizeRangeForCurrentSource();
    renderStrategyButtons();
    renderEditSummary();
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
      range
    });
    designState.displayPlan = displayPlan;
    const primerCount = asArray(displayPlan?.primers).length;
    setStatus(`${formatStrategyLabel(designState.strategy)} designed ${primerCount.toLocaleString()} primer${primerCount === 1 ? '' : 's'}.`, !displayPlan?.feasible);
    render();
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
    if (!getDesignState().displayPlan) {
      designPrimers();
    }
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
      if (!STRATEGIES.some((strategy) => strategy.id === strategyId)) {
        return;
      }
      const designState = getDesignState();
      if (designState.strategy !== strategyId) {
        designState.strategy = strategyId;
        designState.displayPlan = null;
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

    elements.cloningDesignInsertStartInput?.addEventListener('change', handleRangeInput);
    elements.cloningDesignInsertEndInput?.addEventListener('change', handleRangeInput);

    elements.cloningDesignRunBtn?.addEventListener('click', (event) => {
      event.preventDefault();
      designPrimers();
    });

    elements.cloningDesignResult?.addEventListener('click', (event) => {
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
    designPrimers,
    hasDesignSource,
    isOpen: () => isVisibleElement(elements.cloningDesignWorkspace),
    open,
    render,
    syncControls
  };
}
