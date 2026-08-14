import { escapeHtml } from '../../lib/html.js';
import {
  STANDARD_AMINO_ACIDS,
  chooseClosestAminoAcidCodon,
  resolveAminoAcidCodonContext
} from './amino-acid-substitution.js';

function positionFloatingMenu(element, clientX, clientY) {
  if (!element?.style) {
    return;
  }
  const rawX = Number(clientX);
  const rawY = Number(clientY);
  const fallbackX = Number.isFinite(rawX) ? rawX : 16;
  const fallbackY = Number.isFinite(rawY) ? rawY : 16;
  element.style.left = `${Math.max(8, fallbackX)}px`;
  element.style.top = `${Math.max(8, fallbackY)}px`;

  if (typeof element.getBoundingClientRect !== 'function') {
    return;
  }
  const rect = element.getBoundingClientRect();
  const viewportWidth = Number(globalThis?.innerWidth) || 0;
  const viewportHeight = Number(globalThis?.innerHeight) || 0;
  const left = viewportWidth > 0
    ? Math.max(8, Math.min(fallbackX, viewportWidth - rect.width - 8))
    : Math.max(8, fallbackX);
  const top = viewportHeight > 0
    ? Math.max(8, Math.min(fallbackY, viewportHeight - rect.height - 8))
    : Math.max(8, fallbackY);
  element.style.left = `${left}px`;
  element.style.top = `${top}px`;
}

function formatPositionLabel(positions) {
  const sorted = [...positions].sort((left, right) => left - right);
  if (sorted[1] === sorted[0] + 1 && sorted[2] === sorted[1] + 1) {
    return `bases ${sorted[0] + 1}-${sorted[2] + 1}`;
  }
  return `bases ${sorted.map((position) => position + 1).join(', ')}`;
}

export function createSequenceViewerAminoAcidEditingController(config = {}) {
  const elements = config?.elements || {};
  const getSelectedRecord = config?.getSelectedRecord || (() => null);
  const onApplyAminoAcidEdit = config?.onApplyAminoAcidEdit || (async () => {});
  const setStatus = config?.setStatus || (() => {});
  let activeContext = null;

  function clearContext(options = {}) {
    activeContext = null;
    if (options?.hideMenu !== false && elements.featureContextMenu) {
      elements.featureContextMenu.hidden = true;
      elements.featureContextMenu.innerHTML = '';
    }
  }

  function resolveContext(record, event) {
    const trigger = event?.target?.closest?.('[data-aa-codon-positions]') || null;
    if (!trigger || !record?.sequence?.length) {
      return null;
    }
    try {
      const context = resolveAminoAcidCodonContext(record.sequence, {
        codonPositions: trigger.dataset?.aaCodonPositions,
        strand: trigger.dataset?.aaStrand
      });
      const renderedCodon = String(trigger.dataset?.aaCodon || '').toUpperCase();
      const renderedAminoAcid = String(trigger.dataset?.aa || '').toUpperCase();
      if (
        (renderedCodon && renderedCodon !== context.codon)
        || (renderedAminoAcid && renderedAminoAcid !== context.aminoAcid)
      ) {
        return null;
      }
      return context;
    } catch {
      return null;
    }
  }

  function renderContextMenu(context, event) {
    if (!elements.featureContextMenu || !context) {
      return;
    }
    activeContext = context;
    const currentEntry = STANDARD_AMINO_ACIDS.find((entry) => entry.code === context.aminoAcid);
    const currentName = currentEntry?.name || 'Unknown amino acid';
    const options = STANDARD_AMINO_ACIDS
      .filter((entry) => entry.code !== context.aminoAcid)
      .map((entry) => {
        const codon = chooseClosestAminoAcidCodon(context.codon, entry.code);
        return `
          <button
            type="button"
            class="sequence-viewer-aa-replacement-option"
            data-sequence-aa-replacement="${entry.code}"
            title="${escapeHtml(`${entry.name} (${entry.code}) - ${codon}`)}"
            aria-label="${escapeHtml(`Change to ${entry.name} (${entry.code}), codon ${codon}`)}"
          >
            <span class="sequence-viewer-aa-replacement-code">${entry.code}</span>
            <span class="sequence-viewer-aa-replacement-short">${entry.shortName}</span>
          </button>
        `;
      })
      .join('');

    elements.featureContextMenu.innerHTML = `
      <div class="sequence-viewer-aa-edit-context">
        <p class="sequence-viewer-aa-edit-title"><strong>${escapeHtml(context.aminoAcid)}</strong> ${escapeHtml(currentName)}</p>
        <p class="small-note">${escapeHtml(`${context.codon} - ${formatPositionLabel(context.codonPositions)}`)}</p>
        <p class="small-note">Change to (uses the codon with the fewest DNA substitutions):</p>
        <div class="sequence-viewer-aa-replacement-grid" role="group" aria-label="Replacement amino acid">
          ${options}
        </div>
      </div>
    `;
    elements.featureContextMenu.hidden = false;
    positionFloatingMenu(elements.featureContextMenu, Number(event?.clientX) + 4, Number(event?.clientY) + 4);
  }

  async function applyReplacement(targetAminoAcid) {
    const context = activeContext;
    if (!context) {
      return false;
    }
    clearContext();
    try {
      await onApplyAminoAcidEdit({
        codonPositions: context.codonPositions,
        currentAminoAcid: context.aminoAcid,
        currentCodon: context.codon,
        strand: context.strand,
        targetAminoAcid
      });
      return true;
    } catch (error) {
      setStatus(error?.message || 'Failed to change the amino acid.', true);
      return false;
    }
  }

  return {
    applyReplacement,
    clearContext,
    renderContextMenu,
    resolveContext
  };
}
