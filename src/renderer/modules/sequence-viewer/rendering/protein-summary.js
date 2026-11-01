import { createPresentation } from "../../../lib/i18n/presentation.js";
import "../localization.js";
const i18nUi = createPresentation("dna");
import { escapeHtml } from '../../../lib/html.js';
import { getCdsProteinProperties } from '../protein-properties.js';
import { renderProteinCopyButton } from '../protein-copy.js';

function formatDaltons(value) {
  const number = Number(value);
  if (value == null || !Number.isFinite(number)) {
    return 'n/a';
  }
  if (number >= 1000) {
    return `${(number / 1000).toFixed(3)} kDa`;
  }
  return `${number.toFixed(2)} Da`;
}

function formatProteinPropertySummary(properties, { includeDetails = true } = {}) {
  if (!properties) {
    return '';
  }

  const length = Math.max(0, Number(properties.length) || 0).toLocaleString();
  const mass = properties.monoisotopicMass != null && Number.isFinite(Number(properties.monoisotopicMass))
    ? Number(properties.monoisotopicMass).toFixed(2) : null;
  const pI = properties.pI != null && Number.isFinite(Number(properties.pI)) ? Number(properties.pI).toFixed(2) : null;
  const source = String(properties.source || '') === 'derived'
    ? i18nUi.html('derived from CDS DNA')
    : i18nUi.html('from translation');
  const invalidResidues = Array.isArray(properties.invalidResidues) ? properties.invalidResidues : [];

  const sequence = String(properties.sequence || '');
  const composition = Object.entries(properties.composition || {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([residue, count]) => `${residue} ${count} (${((count / sequence.length) * 100).toFixed(1)}%)`);
  const dnaLength = Math.max(0, Number(properties.dnaLength) || 0);

  return [
    `<section class="sequence-viewer-protein-card">
      <div class="sequence-viewer-protein-heading"><strong>${i18nUi.html("Protein:")}</strong> <span>${length} aa</span></div>
      <div class="sequence-viewer-protein-source small-note">${source}</div>
      <dl class="sequence-viewer-protein-metrics">
        <div><dt>${i18nUi.html('Monoisotopic MW')}</dt> <dd><span class="sequence-viewer-protein-mass">${escapeHtml(formatDaltons(properties.monoisotopicMass))}${Number(properties.monoisotopicMass) >= 1000 ? `<small>${mass} Da</small>` : ''}</span>${renderProteinCopyButton(mass, 'mw')}</dd></div>
        <div><dt>${i18nUi.html('pI')}</dt> <dd><span>${pI || 'n/a'}</span>${renderProteinCopyButton(pI, 'pi')}</dd></div>
      </dl>`,
    invalidResidues.length
      ? `<p class="small-note">${i18nUi.html("Protein properties require known residues only; unknown residue(s)")} ${escapeHtml(invalidResidues.join(', '))} ${i18nUi.html("prevent exact MW/pI calculation.")}</p>`
      : '',
    sequence
      ? `<div class="sequence-viewer-protein-sequence-head"><strong>${i18nUi.html('Amino acid sequence')}</strong>${renderProteinCopyButton(sequence, 'sequence')}</div>
        <pre class="sequence-viewer-protein-sequence" tabindex="0" ${i18nUi.attribute('aria-label', 'Amino acid sequence')}>${escapeHtml(sequence.match(/.{1,10}/g).join(' '))}</pre>`
      : '',
    includeDetails && sequence
      ? `<details class="sequence-viewer-protein-details">
        <summary>${i18nUi.html("Protein details")}</summary>
        ${dnaLength ? `<p class="small-note">${i18nUi.html("CDS length:")} ${dnaLength.toLocaleString()} nt</p>` : ''}
        <p class="small-note">${i18nUi.html("Composition:")} ${escapeHtml(composition.join(' · '))}</p>
      </details>`
      : '',
    '</section>'
  ].join('');
}

function renderCdsProteinHoverSection(feature, recordSequence = '') {
  const properties = getCdsProteinProperties(feature, recordSequence);
  return properties
    ? `<div class="sequence-viewer-protein-hover">${formatProteinPropertySummary(properties, { includeDetails: false })}</div>`
    : '';
}

export {
  formatProteinPropertySummary,
  renderCdsProteinHoverSection
};
