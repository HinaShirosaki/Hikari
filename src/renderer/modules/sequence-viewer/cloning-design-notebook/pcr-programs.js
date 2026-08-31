import { cleanText, normalizeSequenceText } from '../shared.js';
import { asArray } from '../../../lib/normalize.js';

function fallbackCreateId(prefix = 'id') {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function createStableId(createId, prefix = 'id') {
  const created = typeof createId === 'function' ? createId() : '';
  return cleanText(created, 120) || fallbackCreateId(prefix);
}

function formatNumber(value, digits = 1) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(digits) : '-';
}

function formatBp(value) {
  return `${Math.max(0, Math.round(Number(value) || 0)).toLocaleString()} bp`;
}

function formatDuration(totalSeconds) {
  const seconds = Math.max(0, Math.round(Number(totalSeconds) || 0));
  if (seconds < 60) {
    return `${seconds} s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder ? `${minutes} min ${remainder} s` : `${minutes} min`;
}

function formatPrimerRole(role) {
  return String(role || '')
    .trim()
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\b\w/g, (match) => match.toUpperCase()) || 'Primer';
}

function formatStrategy(strategy) {
  const labels = {
    'whole-plasmid': 'Whole plasmid PCR',
    'q5-kld': 'Q5/KLD site-directed mutagenesis',
    'two-step-ligation': 'Two-step PCR and digestion-ligation',
    'golden-gate': 'Golden Gate assembly',
    gibson: 'Gibson assembly',
    'in-fusion': 'In-Fusion cloning',
    'overlap-extension': 'Overlap-extension PCR and digestion-ligation'
  };
  return labels[cleanText(strategy, 80)] || formatPrimerRole(strategy) || 'Cloning design';
}

function roundToFiveSeconds(seconds) {
  return Math.max(5, Math.ceil((Number(seconds) || 0) / 5) * 5);
}

function clampTemperature(value, min = 50, max = 72) {
  return Math.max(min, Math.min(max, Math.round(Number(value) || min)));
}

function hashSourceKey(value) {
  let hash = 0x811c9dc5;
  const source = String(value || '');
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function buildNotebookSourceKey(source = {}, record = {}) {
  const edit = source?.editRequest || {};
  return hashSourceKey([
    cleanText(source?.recordName || record?.name, 160),
    normalizeSequenceText(source?.originalSequence || ''),
    normalizeSequenceText(record?.sequence || source?.editedSequence || ''),
    cleanText(edit.type, 80),
    Math.max(0, Number(edit.start) || 0),
    Math.max(0, Number(edit.end) || 0),
    normalizeSequenceText(edit.originalSequence || ''),
    normalizeSequenceText(edit.editedSequence || '')
  ].join('|'));
}

function resolveRestrictionAmpliconLength(displayPlan = {}, source = {}, groupLabel = '') {
  const selection = asArray(displayPlan?.plans)
    .flatMap((entry) => asArray(entry?.plan?.restrictionEnzymeSelection))
    .filter((enzyme) => asArray(enzyme?.segments).length);
  if (selection.length < 2) {
    return 0;
  }
  const positions = selection
    .map((enzyme) => ({
      start: Math.max(0, Number(enzyme?.segments?.[0]?.start) || 0),
      end: Math.max(0, Number(enzyme?.segments?.[0]?.end) || 0)
    }))
    .sort((left, right) => left.start - right.start);
  const upstream = positions[0];
  const downstream = positions[positions.length - 1];
  if (groupLabel === 'PCR 1') {
    const editStart = Math.max(0, (Number(source?.editRequest?.start) || 1) - 1);
    return Math.max(0, downstream.end - editStart);
  }
  return Math.max(0, downstream.end - upstream.start);
}

function resolveAmpliconLength(displayPlan = {}, source = {}, record = {}, groupLabel = '', primers = []) {
  const primerAmpliconLength = Math.max(
    0,
    ...asArray(primers).map((primer) => Math.max(0, Number(primer?.ampliconLength) || 0))
  );
  if (primerAmpliconLength) {
    return primerAmpliconLength;
  }
  const strategy = cleanText(displayPlan?.strategy, 80);
  const summary = displayPlan?.summary || {};
  if (strategy === 'whole-plasmid' || strategy === 'q5-kld' || groupLabel === 'Whole plasmid PCR') {
    return Math.max(
      0,
      Number(summary.templateLength) || 0,
      normalizeSequenceText(source?.originalSequence || '').length,
      normalizeSequenceText(record?.sequence || source?.editedSequence || '').length
    );
  }
  if (strategy === 'two-step-ligation') {
    return resolveRestrictionAmpliconLength(displayPlan, source, groupLabel)
      || Math.max(0, Number(summary.insertLength) || 0);
  }
  const insertLength = Math.max(0, Number(summary.insertLength) || 0);
  return insertLength || Math.max(0, Number(summary.resultLength) || 0);
}

function groupPrimers(primers = []) {
  const groups = new Map();
  asArray(primers).forEach((primer) => {
    const label = cleanText(primer?.groupLabel, 120) || 'PCR';
    if (!groups.has(label)) {
      groups.set(label, []);
    }
    groups.get(label).push(primer);
  });
  return [...groups.entries()].map(([label, group]) => ({ label, primers: group }));
}

function buildSequenceViewerPcrPrograms({ displayPlan = {}, source = {}, record = {} } = {}) {
  const strategy = cleanText(displayPlan?.strategy, 80);
  return groupPrimers(displayPlan?.primers).map(({ label, primers }) => {
    const primerTms = primers
      .map((primer) => Number(primer?.tm))
      .filter((tm) => Number.isFinite(tm) && tm > 0);
    const lowestPrimerTm = primerTms.length ? Math.min(...primerTms) : 60;
    const annealingTemperature = clampTemperature(lowestPrimerTm + 3);
    const ampliconLength = resolveAmpliconLength(displayPlan, source, record, label, primers);
    const extensionSeconds = roundToFiveSeconds(Math.max(30, (ampliconLength / 1000) * 30));
    const isQ5Kld = strategy === 'q5-kld';
    const cycleCount = isQ5Kld ? 25 : 30;
    const primerNames = primers.map((primer) => cleanText(primer?.name, 160)).filter(Boolean);
    const usesMegaprimer = strategy === 'two-step-ligation' && label === 'PCR 2';
    if (usesMegaprimer) {
      primerNames.push('Purified PCR 1 megaprimer');
    }
    return {
      label,
      polymerase: isQ5Kld ? 'Q5 Hot Start High-Fidelity 2X Master Mix' : 'Q5 High-Fidelity DNA Polymerase (or validated equivalent)',
      primerNames,
      lowestPrimerTm,
      annealingTemperature,
      ampliconLength,
      extensionSeconds,
      steps: [
        { label: 'Initial denaturation', temperature: '98 C', time: '30 s', cycles: '1' },
        { label: 'Denaturation', temperature: '98 C', time: '10 s', cycles: String(cycleCount) },
        { label: 'Annealing (Ta)', temperature: `${annealingTemperature} C`, time: '20 s', cycles: String(cycleCount) },
        { label: 'Extension', temperature: '72 C', time: formatDuration(extensionSeconds), cycles: String(cycleCount) },
        { label: 'Final extension', temperature: '72 C', time: '2 min', cycles: '1' },
        { label: 'Hold', temperature: '4 C', time: 'hold', cycles: '1' }
      ],
      notes: [
        `Ta is estimated from the lowest primer binding Tm (${formatNumber(lowestPrimerTm, 1)} C) plus 3 C for Q5-style high-fidelity PCR.`,
        'Binding Tm uses a SantaLucia nearest-neighbour estimate at 0.5 uM primer and 80 mM sodium-equivalent salt.',
        `Extension is estimated at 30 s/kb for the planned ${formatBp(ampliconLength)} amplicon. Adjust to the polymerase data sheet.`,
        usesMegaprimer ? 'PCR 2 uses the purified PCR 1 product as the second primer; optimize Ta with a gradient if amplification is weak.' : ''
      ].filter(Boolean)
    };
  });
}

export {
  buildNotebookSourceKey,
  buildSequenceViewerPcrPrograms,
  createStableId,
  formatBp,
  formatDuration,
  formatNumber,
  formatPrimerRole,
  formatStrategy
};
