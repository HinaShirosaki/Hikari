import { buildCloningReactionSteps } from './cloning-reaction-steps.js';
import { isExecutedNotebookEntry, syncCloningReactionStepPages } from './cloning-step-pages.js';
import { appendGeneratedPcrReaction, buildPcrFixedReactionCalculation } from './pcr-reaction-setup.js';
import { cleanText, normalizeSequenceText } from './shared.js';
import { asArray } from '../../lib/normalize.js';

const CLONING_NOTEBOOK_SOURCE = 'sequence_viewer_cloning_design';
const CLONING_PROJECT_NAME = 'Sequence Viewer';
const CLONING_PROJECT_DESCRIPTION = 'Automatically collected cloning designs from Sequence Viewer.';
const CLONING_PROTOCOL_ID = 'sequence-viewer-cloning-design-pcr-protocol';
const CLONING_PROTOCOL_NAME = 'PCR Thermocycle Program';
const CLONING_REACTION_CALCULATION_ID = 'sequence-viewer-pcr-fixed-reaction';

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

export function buildSequenceViewerPcrPrograms({ displayPlan = {}, source = {}, record = {} } = {}) {
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

function formatThermocycleCondition(step = {}) {
  return [
    cleanText(step?.label, 120) || 'Thermocycle step',
    cleanText(step?.temperature, 60),
    cleanText(step?.time, 60)
  ].filter(Boolean).join(' - ');
}

function buildProtocolSteps(pcrPrograms = []) {
  const multiProgram = asArray(pcrPrograms).length > 1;
  return asArray(pcrPrograms).flatMap((program, programIndex) => {
    const prefix = multiProgram ? `${cleanText(program?.label, 120) || `PCR ${programIndex + 1}`}: ` : '';
    const programSteps = asArray(program?.steps);
    const cyclingSteps = programSteps.filter((step) => Math.max(1, Number(step?.cycles) || 1) > 1);
    const singleSteps = programSteps.filter((step) => Math.max(1, Number(step?.cycles) || 1) === 1);
    const texts = singleSteps
      .filter((step) => cleanText(step?.label, 80).toLowerCase() === 'initial denaturation')
      .map((step) => `${prefix}${formatThermocycleCondition(step)}`);
    if (cyclingSteps.length) {
      const cycleCount = Math.max(...cyclingSteps.map((step) => Math.max(1, Number(step?.cycles) || 1)));
      texts.push(`${prefix}Repeat for ${cycleCount} cycles: ${cyclingSteps.map((step) => formatThermocycleCondition(step)).join('; ')}.`);
    }
    singleSteps
      .filter((step) => cleanText(step?.label, 80).toLowerCase() !== 'initial denaturation')
      .forEach((step) => texts.push(`${prefix}${formatThermocycleCondition(step)}`));
    return texts;
  }).map((text, index) => ({
    id: `${CLONING_PROTOCOL_ID}_step_${index + 1}`,
    text,
    placeholders: []
  }));
}

function buildProtocol(pcrPrograms = [], nowIso = '') {
  return {
    id: CLONING_PROTOCOL_ID,
    name: CLONING_PROTOCOL_NAME,
    purpose: 'Run the generated high-fidelity PCR thermocycle program for this Sequence Viewer cloning design.',
    materials: [
      'DNA template',
      'Designed primer oligos',
      'dNTP mix',
      'High-fidelity DNA polymerase',
      'Polymerase buffer',
      'Nuclease-free water'
    ],
    steps: buildProtocolSteps(pcrPrograms),
    troubleshooting: 'If amplification is weak or nonspecific, adjust Ta and extension time for the selected primer pair and polymerase.',
    createdAt: nowIso,
    updatedAt: nowIso,
    source: CLONING_NOTEBOOK_SOURCE
  };
}

function cloneProtocolSnapshot(protocol = {}) {
  return {
    id: cleanText(protocol?.id, 160),
    name: cleanText(protocol?.name, 220) || CLONING_PROTOCOL_NAME,
    category: cleanText(protocol?.category, 120),
    purpose: cleanText(protocol?.purpose, 1000),
    steps: asArray(protocol?.steps).map((step, index) => ({
      id: cleanText(step?.id, 160) || `${CLONING_PROTOCOL_ID}_step_${index + 1}`,
      text: cleanText(step?.text, 1200),
      placeholders: []
    }))
  };
}

function ensureProject(state, createId, nowIso) {
  state.projects = asArray(state.projects);
  const existing = state.projects.find((project) => (
    cleanText(project?.source, 80) === CLONING_NOTEBOOK_SOURCE
    || cleanText(project?.name, 160).toLowerCase() === CLONING_PROJECT_NAME.toLowerCase()
  ));
  if (existing) {
    return existing;
  }
  const project = {
    id: createStableId(createId, 'sequence_viewer_project'),
    name: CLONING_PROJECT_NAME,
    description: CLONING_PROJECT_DESCRIPTION,
    createdAt: nowIso,
    updatedAt: nowIso,
    source: CLONING_NOTEBOOK_SOURCE
  };
  state.projects.push(project);
  return project;
}

function upsertProtocol(state, nextProtocol, nowIso) {
  state.protocols = asArray(state.protocols);
  const existingIndex = state.protocols.findIndex((protocol) => (
    cleanText(protocol?.id, 160) === cleanText(nextProtocol?.id, 160)
  ));
  if (existingIndex >= 0) {
    state.protocols[existingIndex] = {
      ...state.protocols[existingIndex],
      ...nextProtocol,
      createdAt: cleanText(state.protocols[existingIndex]?.createdAt, 120) || nowIso
    };
    return state.protocols[existingIndex];
  }
  state.protocols.push(nextProtocol);
  return nextProtocol;
}

function ensureProtocol(state, pcrPrograms, nowIso) {
  return upsertProtocol(state, buildProtocol(pcrPrograms, nowIso), nowIso);
}

function buildPrimerResultTable(primers = []) {
  if (!asArray(primers).length) {
    return null;
  }
  return {
    columns: [
      { field: 'step', title: 'PCR Step' },
      { field: 'name', title: 'Primer' },
      { field: 'role', title: 'Role' },
      { field: 'sequence', title: 'Sequence' },
      { field: 'length', title: 'Length' },
      { field: 'tm', title: 'Binding Tm' },
      { field: 'gc', title: 'GC%' },
      { field: 'notes', title: 'Notes' }
    ],
    rows: asArray(primers).map((primer, index) => ({
      id: cleanText(primer?.name, 120) || `primer_${index + 1}`,
      step: cleanText(primer?.groupLabel, 120) || 'PCR',
      name: cleanText(primer?.name, 160) || `Primer ${index + 1}`,
      role: formatPrimerRole(primer?.role),
      sequence: normalizeSequenceText(primer?.sequence || ''),
      length: String(Math.max(0, Number(primer?.length) || normalizeSequenceText(primer?.sequence || '').length)),
      tm: `${formatNumber(primer?.tm, 1)} C`,
      gc: `${formatNumber(primer?.gcContent, 1)}%`,
      notes: [...asArray(primer?.warnings), ...asArray(primer?.qualityWarnings)].filter(Boolean).join(' | ')
    }))
  };
}

function formatPcrPrograms(pcrPrograms = []) {
  return asArray(pcrPrograms).flatMap((program) => [
    cleanText(program?.label, 120) || 'PCR',
    `- Primers: ${asArray(program?.primerNames).join(', ') || 'designed primer set'}`,
    `- Planned amplicon: ${formatBp(program?.ampliconLength)}`,
    `- Ta: ${formatNumber(program?.annealingTemperature, 0)} C (lowest binding Tm ${formatNumber(program?.lowestPrimerTm, 1)} C plus 3 C)`,
    `- Extension time: ${formatDuration(program?.extensionSeconds)} at 72 C (30 s/kb)`,
    ...asArray(program?.steps).map((step) => `- ${step.label}: ${step.temperature}, ${step.time}, ${step.cycles} cycle${String(step.cycles) === '1' ? '' : 's'}`),
    ''
  ]);
}

function formatProcedure(displayPlan = {}) {
  return asArray(displayPlan?.plans).flatMap((entry) => asArray(entry?.plan?.stepByStepProcedure).map((step, index) => {
    const planLabel = cleanText(entry?.label, 120);
    const title = cleanText(step?.title, 160) || `Step ${index + 1}`;
    const details = cleanText(step?.details, 900);
    return `${planLabel ? `${planLabel} - ` : ''}${title}${details ? `: ${details}` : ''}`;
  }));
}

function formatRestrictionEnzymes(displayPlan = {}) {
  return asArray(displayPlan?.plans)
    .flatMap((entry) => asArray(entry?.plan?.restrictionEnzymeSelection))
    .map((enzyme) => {
      const name = cleanText(enzyme?.name || enzyme?.site, 80) || 'Enzyme';
      const site = cleanText(enzyme?.site, 80);
      const cut = cleanText(enzyme?.cut || asArray(enzyme?.cutPatterns)[0], 80);
      return `- ${name}${site ? ` (${site})` : ''}${cut ? `, cut ${cut}` : ''}`;
    });
}

function formatNotebookResult({ source = {}, record = {}, displayPlan = {}, pcrPrograms = [] } = {}) {
  const edit = source?.editRequest || {};
  const summary = displayPlan?.summary || {};
  const procedure = formatProcedure(displayPlan);
  const restrictionEnzymes = formatRestrictionEnzymes(displayPlan);
  const warnings = asArray(displayPlan?.warnings).filter(Boolean);
  const lines = [
    'Sequence Viewer cloning design',
    '',
    `Sequence: ${cleanText(source?.recordName || record?.name, 160) || 'Edited sequence'}`,
    `Route: ${formatStrategy(displayPlan?.strategy)}`,
    `Edit: ${formatPrimerRole(edit?.type)} at ${Math.max(1, Number(edit?.start) || 1)}..${Math.max(1, Number(edit?.end) || Number(edit?.start) || 1)}`,
    `Template length: ${formatBp(summary.templateLength || normalizeSequenceText(source?.originalSequence || '').length)}`,
    `Designed result length: ${formatBp(summary.resultLength || normalizeSequenceText(record?.sequence || source?.editedSequence || '').length)}`,
    `Primer count: ${asArray(displayPlan?.primers).length.toLocaleString()}`,
    '',
    'PCR thermocycle programs',
    ...formatPcrPrograms(pcrPrograms),
    'Bench procedure',
    ...(procedure.length ? procedure.map((step, index) => `${index + 1}. ${step}`) : ['No assembly procedure was generated.'])
  ];
  if (restrictionEnzymes.length) {
    lines.push('', 'Restriction enzymes', ...restrictionEnzymes);
  }
  if (warnings.length) {
    lines.push('', 'Warnings', ...warnings.map((warning) => `- ${warning}`));
  }
  return lines.filter((line, index, list) => line || list[index - 1]).join('\n').trim();
}

export function createSequenceViewerCloningDesignNotebookPage({
  state,
  persist,
  createId,
  onNotebookEntriesChanged,
  entryId: requestedEntryId = '',
  source = {},
  record = {},
  displayPlan = {}
} = {}) {
  if (!state || typeof state !== 'object' || !displayPlan?.feasible || !asArray(displayPlan?.primers).length) {
    return null;
  }
  const nowIso = new Date().toISOString();
  const sourceKey = buildNotebookSourceKey(source, record);
  const project = ensureProject(state, createId, nowIso);
  const pcrPrograms = buildSequenceViewerPcrPrograms({ displayPlan, source, record });
  if (!pcrPrograms.length) {
    return null;
  }
  const protocol = ensureProtocol(state, pcrPrograms, nowIso);
  state.notebookEntries = asArray(state.notebookEntries);
  const matchingEntry = state.notebookEntries.find((candidate) => (
    cleanText(candidate?.sequenceViewerCloningDesign?.source, 80) === CLONING_NOTEBOOK_SOURCE
    && cleanText(candidate?.sequenceViewerCloningDesign?.sourceKey, 80) === sourceKey
    && !isExecutedNotebookEntry(candidate)
  ));
  const requestedId = cleanText(requestedEntryId, 160);
  const requestedEntry = requestedId
    ? state.notebookEntries.find((candidate) => cleanText(candidate?.id, 160) === requestedId) || null
    : null;
  const existingEntry = (isExecutedNotebookEntry(requestedEntry) ? null : requestedEntry) || matchingEntry || null;
  const entryId = cleanText(existingEntry?.id, 160)
    || createStableId(createId, 'sequence_viewer_cloning_entry');
  const existingIndex = existingEntry ? state.notebookEntries.indexOf(existingEntry) : -1;
  const recordName = cleanText(source?.recordName || record?.name, 160) || 'Edited sequence';
  const resultTable = buildPrimerResultTable(displayPlan?.primers);
  const entry = {
    id: entryId,
    notebookType: 'biology',
    projectId: project.id,
    projectName: project.name,
    protocolId: protocol.id,
    protocolName: protocol.name,
    experimentName: `${recordName} cloning primer design`,
    protocolSnapshot: cloneProtocolSnapshot(protocol),
    values: {},
    result: formatNotebookResult({ source, record, displayPlan, pcrPrograms }),
    resultTable,
    resultTables: resultTable ? [resultTable] : [],
    // The thermocycle program says how to run the PCR; the reaction table says
    // what to put in the tube. Every route on this page starts with a PCR, so
    // the page carries both.
    toolCalculations: appendGeneratedPcrReaction(
      existingEntry?.toolCalculations,
      buildPcrFixedReactionCalculation(pcrPrograms[0], nowIso, {
        id: CLONING_REACTION_CALCULATION_ID,
        reactionLabels: pcrPrograms.map((program) => program?.label)
      })
    ),
    resultFiles: asArray(existingEntry?.resultFiles),
    resultFileRecords: asArray(existingEntry?.resultFileRecords),
    storageFolder: cleanText(existingEntry?.storageFolder, 600),
    updatedAt: nowIso,
    createdAt: cleanText(existingEntry?.createdAt, 120) || nowIso,
    notebookState: cleanText(existingEntry?.notebookState, 80) || 'planned',
    executedAt: cleanText(existingEntry?.executedAt, 120),
    agentDraftStatus: '',
    agentDraftMeta: {},
    selectionInsights: asArray(existingEntry?.selectionInsights),
    sequenceViewerCloningDesign: {
      source: CLONING_NOTEBOOK_SOURCE,
      sourceKey,
      recordName,
      strategy: cleanText(displayPlan?.strategy, 80),
      editType: cleanText(source?.editRequest?.type, 80),
      editStart: Math.max(0, Number(source?.editRequest?.start) || 0),
      editEnd: Math.max(0, Number(source?.editRequest?.end) || 0),
      templateLength: Math.max(0, Number(displayPlan?.summary?.templateLength) || 0),
      resultLength: Math.max(0, Number(displayPlan?.summary?.resultLength) || 0),
      primerCount: asArray(displayPlan?.primers).length,
      pcrPrograms
    }
  };
  if (existingIndex >= 0) {
    state.notebookEntries[existingIndex] = { ...existingEntry, ...entry };
  } else {
    state.notebookEntries.push(entry);
  }
  const strategy = cleanText(displayPlan?.strategy, 80);
  const stepEntries = syncCloningReactionStepPages({
    state,
    createId,
    nowIso,
    project,
    source: CLONING_NOTEBOOK_SOURCE,
    pageKey: sourceKey,
    subjectName: recordName,
    strategy,
    steps: buildCloningReactionSteps({ strategy, displayPlan, pcrPrograms })
  });
  if (typeof persist === 'function') {
    persist();
  }
  if (typeof onNotebookEntriesChanged === 'function') {
    onNotebookEntriesChanged();
  }
  return { entry, project, protocol, pcrPrograms, stepEntries };
}
