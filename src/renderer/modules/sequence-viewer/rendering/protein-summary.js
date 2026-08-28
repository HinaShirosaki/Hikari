import { escapeHtml } from '../../../lib/html.js';

function formatDaltons(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return 'n/a';
  }
  if (number >= 1000) {
    return `${(number / 1000).toFixed(3)} kDa (${number.toFixed(2)} Da)`;
  }
  return `${number.toFixed(2)} Da`;
}

function formatProteinPropertySummary(properties) {
  if (!properties) {
    return '';
  }

  const parts = [
    `${Math.max(0, Number(properties.length) || 0).toLocaleString()} aa`,
    `Monoisotopic MW ${formatDaltons(properties.monoisotopicMass)}`,
    `pI ${Number.isFinite(Number(properties.pI)) ? Number(properties.pI).toFixed(2) : 'n/a'}`
  ];
  const source = String(properties.source || '') === 'derived'
    ? 'derived from CDS DNA'
    : 'from translation';
  const invalidResidues = Array.isArray(properties.invalidResidues) ? properties.invalidResidues : [];

  const sequence = String(properties.sequence || '');
  const composition = Object.entries(properties.composition || {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([residue, count]) => `${residue} ${count} (${((count / sequence.length) * 100).toFixed(1)}%)`);
  const dnaLength = Math.max(0, Number(properties.dnaLength) || 0);

  return [
    `<p><strong>Protein:</strong> ${escapeHtml(parts.join(' · '))} <span class="small-note">(${escapeHtml(source)})</span></p>`,
    invalidResidues.length
      ? `<p class="small-note">Protein properties require known residues only; unknown residue(s) ${escapeHtml(invalidResidues.join(', '))} prevent exact MW/pI calculation.</p>`
      : '',
    sequence
      ? `<details class="sequence-viewer-protein-details">
        <summary>Protein details</summary>
        ${dnaLength ? `<p class="small-note">CDS length: ${dnaLength.toLocaleString()} nt</p>` : ''}
        <p class="small-note">Composition: ${escapeHtml(composition.join(' · '))}</p>
        <pre class="sequence-viewer-protein-sequence">${escapeHtml(sequence.match(/.{1,10}/g).join(' '))}</pre>
      </details>`
      : ''
  ].join('');
}

export {
  formatProteinPropertySummary
};
