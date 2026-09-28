import {
  CODON_USAGE_PROFILES,
  REVERSE_TRANSLATE_DEFAULT_ORGANISM,
  REVERSE_TRANSLATE_MIN_SITE_LENGTH,
  cleanNucleotideSequence,
  cleanProteinSequence,
  reverseTranslateProteinSequence,
  translateDnaSequence
} from '../sequence-viewer/calculations/sequence.js';
import { COMMERCIAL_RESTRICTION_ENZYMES } from '../sequence-viewer/data/commercial-restriction-enzymes.js';

// Only unambiguous motifs the reverse translator can actually avoid.
const AVOIDABLE_ENZYMES = COMMERCIAL_RESTRICTION_ENZYMES
  .filter((entry) => new RegExp(`^[ACGT]{${REVERSE_TRANSLATE_MIN_SITE_LENGTH},}$`).test(entry.site))
  .map((entry) => ({
    name: entry.name,
    site: entry.site,
    aliases: (entry.enzymeNames || []).filter((alias) => alias !== entry.name)
  }))
  .sort((a, b) => a.name.localeCompare(b.name));

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

    dnaProteinResult.innerHTML = `<div class="sequence-block">${translated.protein || '-'}</div>`;
  }

  const availableList = rootDocument.getElementById('reverse-translate-site-available');
  const selectedList = rootDocument.getElementById('reverse-translate-site-selected');
  const siteFilterInput = rootDocument.getElementById('reverse-translate-site-filter');
  const selectedEnzymes = new Set();

  function renderEnzymeItem(entry, action) {
    const aliasNote = entry.aliases.length ? ` title="Isoschizomers: ${entry.aliases.join(', ')}"` : '';
    return `<button type="button" role="listitem" class="reverse-translate-site-item" data-site-action="${action}" data-site-name="${entry.name}"${aliasNote}>`
      + `<span class="reverse-translate-site-name">${entry.name}</span>`
      + `<span class="reverse-translate-site-motif">${entry.site}</span>`
      + '</button>';
  }

  function renderEnzymePicker() {
    if (!availableList || !selectedList) {
      return;
    }

    const query = String(siteFilterInput?.value || '').trim().toUpperCase();
    const available = AVOIDABLE_ENZYMES.filter((entry) => !selectedEnzymes.has(entry.name)
      && (!query || entry.name.toUpperCase().includes(query)
        || entry.site.includes(query)
        || entry.aliases.some((alias) => alias.toUpperCase().includes(query))));
    const selected = AVOIDABLE_ENZYMES.filter((entry) => selectedEnzymes.has(entry.name));

    availableList.innerHTML = available.length
      ? available.map((entry) => renderEnzymeItem(entry, 'add')).join('')
      : '<p class="small-note">No enzyme matches this filter.</p>';
    selectedList.innerHTML = selected.length
      ? selected.map((entry) => renderEnzymeItem(entry, 'remove')).join('')
      : '<p class="small-note">Click an enzyme to avoid its site.</p>';
  }

  function handleEnzymePickerClick(event) {
    const button = event.target?.closest?.('[data-site-action]');
    if (!button) {
      return;
    }
    const name = button.dataset?.siteName || button.getAttribute?.('data-site-name');
    if (!name) {
      return;
    }
    if (button.dataset?.siteAction === 'remove' || button.getAttribute?.('data-site-action') === 'remove') {
      selectedEnzymes.delete(name);
    } else {
      selectedEnzymes.add(name);
    }
    renderEnzymePicker();
    renderReverseTranslate();
  }

  function renderReverseTranslate() {
    if (!reverseTranslateResult) {
      return;
    }

    const rawProtein = rootDocument.getElementById('reverse-translate-protein')?.value;
    const organism = reverseTranslateOrganismSelect?.value || REVERSE_TRANSLATE_DEFAULT_ORGANISM;
    const appendStopCodon = Boolean(rootDocument.getElementById('reverse-translate-append-stop')?.checked);
    const cleanedProtein = cleanProteinSequence(rawProtein, true);
    if (!cleanedProtein.length) {
      reverseTranslateResult.innerHTML = '<p class="small-note">Enter a protein sequence to reverse translate.</p>';
      return;
    }

    const translated = reverseTranslateProteinSequence(cleanedProtein, {
      organism,
      restrictionSites: AVOIDABLE_ENZYMES.filter((entry) => selectedEnzymes.has(entry.name)).map((entry) => entry.site),
      appendStopCodon
    });

    if (!translated.ok) {
      reverseTranslateResult.innerHTML = translated.dna
        ? `<div class="sequence-block">${translated.dna}</div>`
        : '<p class="small-note">Unable to generate a DNA sequence with the current settings.</p>';
      return;
    }

    reverseTranslateResult.innerHTML = `<div class="sequence-block">${translated.dna || '-'}</div>`;
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

  renderEnzymePicker();
  availableList?.addEventListener('click', handleEnzymePickerClick);
  selectedList?.addEventListener('click', handleEnzymePickerClick);
  siteFilterInput?.addEventListener('input', renderEnzymePicker);

  if (reverseTranslateForm && reverseTranslateResult) {
    reverseTranslateForm.addEventListener('input', renderReverseTranslate);
    reverseTranslateForm.addEventListener('submit', (event) => {
      event.preventDefault();
      renderReverseTranslate();
    });
    renderReverseTranslate();
  }
}
