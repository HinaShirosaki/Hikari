import { formatSequenceLines } from './common.js';
import {
  CODON_USAGE_PROFILES,
  REVERSE_TRANSLATE_DEFAULT_ORGANISM,
  cleanNucleotideSequence,
  cleanProteinSequence,
  parseRestrictionSites,
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

    dnaProteinResult.innerHTML = `<div class="sequence-block">${formatSequenceLines(translated.protein || '-')}</div>`;
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
    if (!cleanedProtein.length) {
      reverseTranslateResult.innerHTML = '<p class="small-note">Enter a protein sequence to reverse translate.</p>';
      return;
    }

    const translated = reverseTranslateProteinSequence(cleanedProtein, {
      organism,
      restrictionSites: parsedSites.sites,
      appendStopCodon
    });

    if (!translated.ok) {
      reverseTranslateResult.innerHTML = translated.dna
        ? `<div class="sequence-block">${formatSequenceLines(translated.dna)}</div>`
        : '<p class="small-note">Unable to generate a DNA sequence with the current settings.</p>';
      return;
    }

    reverseTranslateResult.innerHTML = `<div class="sequence-block">${formatSequenceLines(translated.dna || '-')}</div>`;
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
