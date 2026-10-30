import { escapeHtml } from '../../../lib/html.js';
import { designPcrPrimerPair } from '../cloning-assembly.js';
import { clamp, cleanText, normalizeRecordName, normalizeSequenceText } from '../shared.js';
import { renderPrimerCopyButton } from '../primer-copy.js';
import { annotatePrimersOnSelectedRecord } from '../primer-annotation.js';
import {
  formatBaseRangeLabel,
  formatNumber,
  formatPrimerRole,
  getFeatureOverallRange
} from './feature-ranges.js';

// The primer-design overlay: pick a target span, run the designer, and render
// the resulting pair with its warnings.
function createPrimerDesignOverlay({
  state,
  elements,
  getSelectedRecord,
  setStatus,
  renderActiveRecord,
  persistFeatureMutation,
  hideFeatureContextMenu
} = {}) {
  // Last designed pair, kept here so the order action can re-read it.
  let designedPrimers = [];

  function renderPrimerDesignTable(primers = []) {
    if (!primers.length) {
      return '<p class="small-note">No primer pair was generated for this sequence.</p>';
    }

    return `
      <div class="sequence-viewer-cloning-design-primer-table-wrap">
        <table class="sequence-viewer-cloning-design-primer-table">
          <thead>
            <tr>
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

  function renderPrimerDesignWarnings(warnings = []) {
    const safeWarnings = (Array.isArray(warnings) ? warnings : [])
      .map((warning) => cleanText(warning, 500))
      .filter(Boolean);
    if (!safeWarnings.length) {
      return '';
    }
    return `
      <div class="sequence-viewer-primer-design-warnings">
        ${safeWarnings.map((warning) => `<p class="small-note sequence-viewer-primer-design-warning">${escapeHtml(warning)}</p>`).join('')}
      </div>
    `;
  }

  function resolvePrimerDesignTarget(record, context = {}) {
    const sequence = normalizeSequenceText(record?.sequence || '');
    if (!sequence.length) {
      return null;
    }

    const sequenceLength = sequence.length;
    const feature = context?.featureContext?.feature || null;
    const selectionRange = context?.selectionRange || null;
    const featureRange = getFeatureOverallRange(feature, sequenceLength);
    const sourceRange = selectionRange || featureRange;
    if (!sourceRange) {
      return null;
    }

    const start = clamp(Math.round(Number(sourceRange.start) || 0), 0, sequenceLength);
    const end = clamp(Math.round(Number(sourceRange.end) || start), start, sequenceLength);
    if (end <= start) {
      return null;
    }

    const featureName = cleanText(feature?.name, 160);
    const rangeLabel = formatBaseRangeLabel({ start, end });
    return {
      start,
      end,
      rangeLabel,
      label: featureName ? `${featureName} - ${rangeLabel}` : `Selection - ${rangeLabel}`,
      // The feature is the best name; a bare selection falls back to the record
      // and its coordinates, e.g. "pVector 120-460 F".
      primerBaseName: normalizeRecordName(
        featureName || `${cleanText(record?.name, 80) || 'selection'} ${start + 1}-${end}`,
        'selection'
      ),
      sequence: sequence.slice(start, end)
    };
  }

  function openPrimerDesignOverlay(context = {}) {
    const record = getSelectedRecord();
    if (!record?.sequence?.length) {
      setStatus('Load a record before designing primers.', true);
      return;
    }

    const target = resolvePrimerDesignTarget(record, context);
    if (!target) {
      setStatus('Select a sequence range or feature before designing primers.', true);
      return;
    }

    const primerPlan = designPcrPrimerPair(target.sequence, {
      name: target.primerBaseName,
      // The selected fragment chooses the amplicon boundaries, but the whole
      // record is the PCR template. A primer unique inside the selection can
      // still bind another copy elsewhere on the plasmid.
      specificitySequence: record.sequence,
      specificityCircular: cleanText(record?.topology, 40).toLowerCase() === 'circular'
    });
    const primers = Array.isArray(primerPlan?.primers) ? primerPlan.primers : [];
    designedPrimers = primers;
    const thresholdLabel = cleanText(primerPlan?.selectedThresholdLevel, 80) || 'none';

    if (elements.primerDesignTitle) {
      elements.primerDesignTitle.textContent = 'Designed Primers';
    }
    if (elements.primerDesignNote) {
      elements.primerDesignNote.textContent = `PCR primer pair for ${target.label}.`;
    }
    if (elements.primerDesignResult) {
      elements.primerDesignResult.innerHTML = `
        <div class="sequence-viewer-primer-design-summary">
          <p><strong>Template:</strong> ${escapeHtml(target.label)}</p>
          <p><strong>Selected sequence:</strong> ${target.sequence.length.toLocaleString()} bp</p>
          <p><strong>Threshold profile:</strong> ${escapeHtml(thresholdLabel)}</p>
        </div>
        ${renderPrimerDesignTable(primers)}
        ${renderPrimerDesignWarnings(primerPlan?.warnings)}
      `;
    }

    hideFeatureContextMenu();
    if (elements.primerDesignOverlay) {
      elements.primerDesignOverlay.hidden = false;
    }
    elements.primerDesignCloseBtn?.focus?.();

    // Returned so a caller in another workspace can re-render once the primers
    // are on the record.
    return (async () => {
      const placed = await annotatePrimersOnSelectedRecord({
        state,
        primers,
        persistFeatureMutation,
        label: `Annotated ${primers.length} designed primer${primers.length === 1 ? '' : 's'} on the sequence.`
      });
      if (placed) {
        renderActiveRecord();
      }
    })();
  }

  return {
    getDesignedPrimers: () => designedPrimers,
    renderPrimerDesignTable,
    renderPrimerDesignWarnings,
    resolvePrimerDesignTarget,
    openPrimerDesignOverlay
  };
}

export { createPrimerDesignOverlay };
