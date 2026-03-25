import { escapeHtml, formatSequenceLines } from './common.js';
import {
  CODON_USAGE_PROFILES,
  REVERSE_TRANSLATE_DEFAULT_ORGANISM,
  REVERSE_TRANSLATE_MIN_SITE_LENGTH,
  cleanNucleotideSequence,
  cleanProteinSequence,
  parseRestrictionSites,
  resolveCodonProfile,
  reverseTranslateProteinSequence,
  translateDnaSequence
} from './sequence.js';

export function initTranslationTool(options = {}) {
  const rootDocument = options?.document || globalThis?.document || null;
  if (!rootDocument) {
    return;
  }

  const dnaProteinForm = rootDocument.getElementById('dna-protein-form');
  const dnaProteinResult = rootDocument.getElementById('dna-protein-result');
  const reverseTranslateForm = rootDocument.getElementById('reverse-translate-form');
  const reverseTranslateOrganismSelect = rootDocument.getElementById('reverse-translate-organism');
  const reverseTranslateResult = rootDocument.getElementById('reverse-translate-result');

  function populateReverseTranslateProfileOptions() {
    if (!reverseTranslateOrganismSelect) {
      return;
    }

    const selected = CODON_USAGE_PROFILES[reverseTranslateOrganismSelect.value]
      ? reverseTranslateOrganismSelect.value
      : REVERSE_TRANSLATE_DEFAULT_ORGANISM;

    reverseTranslateOrganismSelect.innerHTML = Object.entries(CODON_USAGE_PROFILES)
      .map(([key, profile]) => `<option value="${key}"${key === selected ? ' selected' : ''}>${profile.label}</option>`)
      .join('');
    reverseTranslateOrganismSelect.value = selected;
  }

  function renderDnaProtein() {
    if (!dnaProteinResult) {
      return;
    }

    const raw = rootDocument.getElementById('dna-protein-sequence')?.value;
    const type = rootDocument.getElementById('dna-protein-type')?.value;
    const frame = rootDocument.getElementById('dna-protein-frame')?.value;
    const stopMode = rootDocument.getElementById('dna-protein-stop-mode')?.value;

    const nucleotideSequence = cleanNucleotideSequence(raw, type);
    if (!nucleotideSequence.length) {
      dnaProteinResult.innerHTML = '<p class="small-note">Enter DNA or RNA sequence for translation.</p>';
      return;
    }

    const dnaSequence = type === 'RNA'
      ? nucleotideSequence.replace(/U/g, 'T')
      : nucleotideSequence;
    const translated = translateDnaSequence(dnaSequence, frame, stopMode);

    dnaProteinResult.innerHTML = `
      <p><strong>Nucleotide length:</strong> ${nucleotideSequence.length}</p>
      <p><strong>Reading frame:</strong> ${translated.strand}${translated.frame}</p>
      <p><strong>Codons translated:</strong> ${translated.codons}</p>
      <p><strong>Remainder bases:</strong> ${translated.remainderBases}</p>
      <p><strong>Protein length:</strong> ${translated.protein.length} aa</p>
      <p><strong>Protein sequence:</strong></p>
      <div class="sequence-block">${formatSequenceLines(translated.protein || '-')}</div>
    `;
  }

  function renderReverseTranslate() {
    if (!reverseTranslateResult) {
      return;
    }

    const rawProtein = rootDocument.getElementById('reverse-translate-protein')?.value;
    const organism = reverseTranslateOrganismSelect?.value || REVERSE_TRANSLATE_DEFAULT_ORGANISM;
    const restrictionRaw = rootDocument.getElementById('reverse-translate-sites')?.value;
    const appendStopCodon = Boolean(rootDocument.getElementById('reverse-translate-append-stop')?.checked);
    const cleanedProtein = cleanProteinSequence(rawProtein, true);
    const parsedSites = parseRestrictionSites(restrictionRaw);
    const warningRows = [];

    if (!cleanedProtein.length) {
      reverseTranslateResult.innerHTML = '<p class="small-note">Enter a protein sequence to reverse translate.</p>';
      return;
    }

    if (parsedSites.ignoredTokens.length) {
      warningRows.push(
        `<p class="small-note">Ignored site tokens: ${escapeHtml(parsedSites.ignoredTokens.join(', '))}. Use DNA motifs with A/C/G/T and at least ${REVERSE_TRANSLATE_MIN_SITE_LENGTH} nt.</p>`
      );
    }

    const translated = reverseTranslateProteinSequence(cleanedProtein, {
      organism,
      restrictionSites: parsedSites.sites,
      appendStopCodon
    });

    if (!translated.ok) {
      const progressLine = Number.isFinite(translated.translatedResidues)
        ? `<p><strong>Progress:</strong> ${translated.translatedResidues}/${cleanedProtein.length} residues translated.</p>`
        : '';
      const partialDnaBlock = translated.dna
        ? `
          <p><strong>Partial DNA sequence:</strong></p>
          <div class="sequence-block">${formatSequenceLines(translated.dna)}</div>
        `
        : '';

      reverseTranslateResult.innerHTML = `
        <p><strong>Status:</strong> Unable to satisfy all constraints.</p>
        <p><strong>Reason:</strong> ${escapeHtml(translated.message || 'Unknown constraint error.')}</p>
        <p><strong>Organism profile:</strong> ${escapeHtml(translated.organismLabel || resolveCodonProfile(organism).label)}</p>
        ${progressLine}
        ${partialDnaBlock}
        ${warningRows.join('')}
      `;
      return;
    }

    const verificationProtein = translateDnaSequence(translated.dna, 1, 'star').protein;
    const restrictionSummary = translated.restrictionSites.length
      ? translated.restrictionSites.join(', ')
      : 'None';

    reverseTranslateResult.innerHTML = `
      <p><strong>Organism profile:</strong> ${escapeHtml(translated.organismLabel)}</p>
      <p><strong>Protein length:</strong> ${translated.aaLength} aa</p>
      <p><strong>DNA length:</strong> ${translated.ntLength} bp</p>
      <p><strong>GC content:</strong> ${translated.gcContent.toFixed(2)}%</p>
      <p><strong>Codon preference score:</strong> ${translated.preferenceScorePercent.toFixed(2)}%</p>
      <p><strong>Restricted motifs avoided:</strong> ${escapeHtml(restrictionSummary)}</p>
      <p><strong>DNA sequence:</strong></p>
      <div class="sequence-block">${formatSequenceLines(translated.dna || '-')}</div>
      <p><strong>Codon sequence:</strong></p>
      <div class="sequence-block">${formatSequenceLines(translated.codons.join(' ') || '-')}</div>
      <p><strong>Translation check (+1 frame):</strong> ${escapeHtml(verificationProtein || '-')}</p>
      ${warningRows.join('')}
    `;
  }

  populateReverseTranslateProfileOptions();

  if (dnaProteinForm && dnaProteinResult) {
    dnaProteinForm.addEventListener('input', renderDnaProtein);
    dnaProteinForm.addEventListener('submit', (event) => {
      event.preventDefault();
      renderDnaProtein();
    });
    renderDnaProtein();
  }

  if (reverseTranslateForm && reverseTranslateResult) {
    reverseTranslateForm.addEventListener('input', renderReverseTranslate);
    reverseTranslateForm.addEventListener('submit', (event) => {
      event.preventDefault();
      renderReverseTranslate();
    });
    renderReverseTranslate();
  }
}
