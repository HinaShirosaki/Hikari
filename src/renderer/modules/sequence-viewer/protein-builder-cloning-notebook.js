import { assembleCloningPlan } from './cloning-assembly.js';
import { calculateFixedReaction } from '../../lib/bench-calculations.js';
import { PROTEIN_ASSEMBLY_TAGS } from './protein-builder/assembly-model.js';
import { renamePrimers } from './primer-naming.js';
import { cleanText, normalizeSequenceText } from './shared.js';

const CLONING_NOTEBOOK_SOURCE = 'protein_builder_cloning_assembly';
const CLONING_PROJECT_NAME = 'Protein Builder';
const CLONING_PROJECT_DESCRIPTION = 'Automatically collected cloning designs from Protein Builder.';
const CLONING_PROTOCOL_ID = 'protein-builder-cloning-assembly-protocol';
const CLONING_PROTOCOL_NAME = 'PCR Thermocycle Program';
const LEGACY_CLONING_PROTOCOL_NAME = 'Protein Builder Cloning Assembly';
const CLONING_REACTION_CALCULATION_ID = 'protein-builder-pcr-fixed-reaction';

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function fallbackCreateId(prefix = 'id') {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function createStableId(createId, prefix = 'id') {
  const created = typeof createId === 'function' ? createId() : '';
  return cleanText(created, 120) || fallbackCreateId(prefix);
}

function formatNumber(value, digits = 1) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return '';
  }
  return number.toFixed(digits);
}

function formatBp(length) {
  return `${Math.max(0, Number(length) || 0).toLocaleString()} bp`;
}

function formatPrimerRole(role) {
  return String(role || '')
    .trim()
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\b\w/g, (match) => match.toUpperCase()) || 'Primer';
}

function formatStrategyName(strategy) {
  const normalized = String(strategy || '').trim().toLowerCase();
  if (normalized === 'restriction-ligation') {
    return 'Restriction ligation';
  }
  if (normalized === 'gibson') {
    return 'Gibson assembly';
  }
  if (normalized === 'overlap-pcr') {
    return 'Overlap PCR';
  }
  if (normalized === 'site-directed-mutagenesis') {
    return 'Site-directed mutagenesis';
  }
  return normalized ? formatPrimerRole(normalized) : 'No feasible route';
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

function roundToFiveSeconds(seconds) {
  return Math.max(5, Math.ceil((Number(seconds) || 0) / 5) * 5);
}

function clampTemperature(value, min = 50, max = 72) {
  return Math.max(min, Math.min(max, Math.round(Number(value) || min)));
}

function buildBackboneName(backbone = {}) {
  return cleanText(backbone?.hostVectorName, 160)
    || cleanText(backbone?.backboneName, 160)
    || cleanText(backbone?.sourceRecordName, 160)
    || cleanText(backbone?.entryName, 160)
    || 'Stored backbone';
}

function resolveBackboneInsertionOffset(backboneSequence, backbone = {}) {
  const sequenceLength = Math.max(0, normalizeSequenceText(backboneSequence || '').length);
  const explicitOffset = Number(backbone?.insertionOffset);
  if (!Number.isFinite(explicitOffset)) {
    return sequenceLength;
  }
  return Math.max(0, Math.min(sequenceLength, Math.round(explicitOffset)));
}

function linearizeBackboneAtInsertionOffset(backboneSequence, backbone = {}) {
  const sequence = normalizeSequenceText(backboneSequence || '');
  if (!sequence.length || cleanText(backbone?.topology, 40).toLowerCase() === 'linear') {
    return sequence;
  }

  const insertionOffset = resolveBackboneInsertionOffset(sequence, backbone);
  if (insertionOffset <= 0 || insertionOffset >= sequence.length) {
    return sequence;
  }

  return `${sequence.slice(insertionOffset)}${sequence.slice(0, insertionOffset)}`;
}

function resolveDnaConstructTemplateSequence(dnaConstruct = {}) {
  const desiredSequence = normalizeSequenceText(dnaConstruct?.sequence || '');
  if (!desiredSequence.length) {
    return '';
  }

  return asArray(dnaConstruct?.parts)
    .map((part) => normalizeSequenceText(
      part?.templateSequence
      || part?.sourceTemplateSequence
      || part?.sourceDnaSequence
      || ''
    ))
    .filter((sequence) => sequence.length)
    .sort((left, right) => right.length - left.length)[0] || '';
}

function resolveBackboneCloningPreferences(backbone = {}) {
  const variantMode = cleanText(backbone?.variantMode || backbone?.variant_mode, 60).toLowerCase();
  if (variantMode === 'restriction' || variantMode === 'restriction-ligation') {
    return {
      allowRestrictionLigation: true,
      preferRestrictionLigation: true
    };
  }
  if (
    variantMode === 'gibson'
    || variantMode === 'hr'
    || variantMode === 'homology'
    || variantMode === 'homology-recombination'
    || variantMode === 'homologous-recombination'
  ) {
    return {
      allowRestrictionLigation: false,
      preferRestrictionLigation: false,
      preferGibsonForMultiFragment: true
    };
  }
  return {};
}

function resolvePcrTargets(plan = {}) {
  const strategy = cleanText(plan?.recommendedAssemblyStrategy, 80).toLowerCase();
  const fragments = asArray(plan?.orderedFragmentMap?.fragments)
    .map((fragment) => ({
      name: cleanText(fragment?.name, 160) || cleanText(fragment?.id, 120) || 'Fragment',
      role: cleanText(fragment?.role || fragment?.type, 80).toLowerCase(),
      length: Math.max(0, Number(fragment?.sequence?.length || fragment?.length) || 0)
    }))
    .filter((fragment) => fragment.length > 0);

  if (strategy === 'restriction-ligation' || strategy === 'overlap-pcr') {
    const inserts = fragments.filter((fragment) => fragment.role !== 'backbone');
    return inserts.length ? inserts : fragments;
  }
  if (strategy === 'site-directed-mutagenesis') {
    const host = fragments.find((fragment) => fragment.role === 'backbone') || fragments[0];
    return host ? [{ ...host, name: `${host.name} edit amplicon` }] : [];
  }
  return fragments;
}

// A tag block at either end of the construct is what the flanking primer adds,
// so it belongs in that primer's name: "GST APA2 F".
function terminalTagLabels(dnaConstruct = {}) {
  const parts = asArray(dnaConstruct?.parts);
  // Longest first, so "6xHis-TEV" reports 6xHis and "8xHis" is not read as His.
  const tagLabels = PROTEIN_ASSEMBLY_TAGS
    .map((tag) => cleanText(tag?.label, 40))
    .filter(Boolean)
    .sort((left, right) => right.length - left.length);
  const tagIn = (part) => {
    const label = cleanText(part?.label, 60);
    return tagLabels.find((tag) => label.toLowerCase().includes(tag.toLowerCase())) || '';
  };
  return {
    start: tagIn(parts[0]),
    end: parts.length > 1 ? tagIn(parts[parts.length - 1]) : ''
  };
}

export function buildProteinBuilderCloningPlan({
  backbone = {},
  dnaConstruct = {},
  assembledRecord = {},
  constructName = ''
} = {}) {
  const rawBackboneSequence = normalizeSequenceText(backbone?.backboneSequence || '');
  const backboneSequence = linearizeBackboneAtInsertionOffset(rawBackboneSequence, backbone);
  const insertSequence = normalizeSequenceText(dnaConstruct?.sequence || '');
  const insertTemplateSequence = resolveDnaConstructTemplateSequence(dnaConstruct);
  const resultSequence = normalizeSequenceText(assembledRecord?.sequence || '');
  const safeConstructName = cleanText(constructName, 160)
    || cleanText(assembledRecord?.name, 160)
    || 'Protein Builder Insert';
  const backboneName = buildBackboneName(backbone);

  if (!backboneSequence.length || !insertSequence.length) {
    return null;
  }

  const plan = assembleCloningPlan({
    hostVectors: [
      {
        id: 'protein_builder_backbone',
        name: backboneName,
        topology: cleanText(backbone?.topology, 40).toLowerCase() === 'linear' ? 'linear' : 'circular',
        sequence: backboneSequence
      }
    ],
    hostVectorId: 'protein_builder_backbone',
    fragments: [
      {
        id: 'protein_builder_insert',
        name: safeConstructName,
        type: 'insert',
        sequence: insertSequence,
        metadata: {
          source: 'protein_builder',
          partCount: asArray(dnaConstruct?.parts).length,
          templateSequence: insertTemplateSequence
        }
      }
    ],
    resultSequence,
    preferences: resolveBackboneCloningPreferences(backbone)
  });

  if (plan?.primerOligoPlan?.primers) {
    plan.primerOligoPlan.primers = renamePrimers(plan.primerOligoPlan.primers, {
      targetLabel: safeConstructName,
      tags: terminalTagLabels(dnaConstruct),
      backboneNames: [backboneName]
    });
  }
  return plan;
}

export function buildProteinBuilderPcrProgram(plan = {}) {
  const primers = asArray(plan?.primerOligoPlan?.primers);
  const primerTms = primers
    .map((primer) => Number(primer?.tm))
    .filter((tm) => Number.isFinite(tm) && tm > 0);
  const lowestPrimerTm = primerTms.length ? Math.min(...primerTms) : 60;
  const annealingTemperature = clampTemperature(lowestPrimerTm + 3);
  const pcrTargets = resolvePcrTargets(plan);
  const longestAmpliconLength = Math.max(
    0,
    ...pcrTargets.map((target) => Math.max(0, Number(target?.length) || 0))
  );
  const extensionSeconds = roundToFiveSeconds(Math.max(30, (longestAmpliconLength / 1000) * 30));

  return {
    polymerase: 'High-fidelity DNA polymerase',
    annealingTemperature,
    longestAmpliconLength,
    pcrTargets,
    steps: [
      { label: 'Initial denaturation', temperature: '98 C', time: '30 s', cycles: '1' },
      { label: 'Denaturation', temperature: '98 C', time: '10 s', cycles: '30' },
      { label: 'Annealing', temperature: `${annealingTemperature} C`, time: '20 s', cycles: '30' },
      { label: 'Extension', temperature: '72 C', time: formatDuration(extensionSeconds), cycles: '30' },
      { label: 'Final extension', temperature: '72 C', time: '2 min', cycles: '1' },
      { label: 'Hold', temperature: '4 C', time: 'hold', cycles: '1' }
    ],
    notes: [
      `Annealing temperature is estimated from the lowest primer binding Tm (${formatNumber(lowestPrimerTm, 1)} C) plus 3 C for Q5-style high-fidelity PCR.`,
      'Binding Tm uses a SantaLucia nearest-neighbour estimate at 0.5 uM primer and 80 mM sodium-equivalent salt.',
      `Extension is estimated at 30 s/kb for the longest planned PCR target (${formatBp(longestAmpliconLength)}). Adjust to the polymerase data sheet.`
    ]
  };
}

export function buildProteinBuilderPrimerResultTable(plan = {}) {
  const primers = asArray(plan?.primerOligoPlan?.primers);
  if (!primers.length) {
    return null;
  }

  const columns = [
    { field: 'name', title: 'Primer' },
    { field: 'role', title: 'Role' },
    { field: 'sequence', title: 'Sequence' },
    { field: 'length', title: 'Length' },
    { field: 'tm', title: 'Binding Tm' },
    { field: 'gc', title: 'GC%' },
    { field: 'notes', title: 'Notes' }
  ];
  const rows = primers.map((primer, index) => ({
    id: cleanText(primer?.name, 120) || `primer_${index + 1}`,
    name: cleanText(primer?.name, 160) || `Primer ${index + 1}`,
    role: formatPrimerRole(primer?.role),
    sequence: normalizeSequenceText(primer?.sequence || ''),
    length: String(Math.max(0, Number(primer?.length) || normalizeSequenceText(primer?.sequence || '').length)),
    tm: `${formatNumber(primer?.tm, 1)} C`,
    gc: `${formatNumber(primer?.gcContent, 1)}%`,
    notes: [...asArray(primer?.warnings), ...asArray(primer?.qualityWarnings)].filter(Boolean).join(' | ')
  }));

  return {
    columns,
    rows
  };
}

function formatPcrProgramLines(program = {}) {
  const lines = [
    `Polymerase: ${program.polymerase || 'High-fidelity DNA polymerase'}`,
    `Longest PCR target: ${formatBp(program.longestAmpliconLength)}`
  ];
  asArray(program.steps).forEach((step) => {
    lines.push(`- ${step.label}: ${step.temperature}, ${step.time}, ${step.cycles} cycle${String(step.cycles) === '1' ? '' : 's'}`);
  });
  asArray(program.notes).forEach((note) => {
    lines.push(`- ${note}`);
  });
  return lines;
}

function formatPrimerLines(plan = {}) {
  const primers = asArray(plan?.primerOligoPlan?.primers);
  if (!primers.length) {
    return ['No primer set was generated for the selected route.'];
  }
  return primers.map((primer) => {
    const notes = [...asArray(primer?.warnings), ...asArray(primer?.qualityWarnings)].filter(Boolean).join(' ');
    return [
      `- ${cleanText(primer?.name, 160) || 'Primer'}`,
      `role: ${formatPrimerRole(primer?.role)}`,
      `sequence: ${normalizeSequenceText(primer?.sequence || '')}`,
      `length: ${Math.max(0, Number(primer?.length) || 0)} nt`,
      `Tm: ${formatNumber(primer?.tm, 1)} C`,
      `GC: ${formatNumber(primer?.gcContent, 1)}%`,
      notes ? `notes: ${notes}` : ''
    ].filter(Boolean).join('; ');
  });
}

function formatProcedureLines(plan = {}) {
  return asArray(plan?.stepByStepProcedure).map((step, index) => {
    const title = cleanText(step?.title, 160) || `Step ${index + 1}`;
    const details = cleanText(step?.details, 600);
    return `${index + 1}. ${title}${details ? `: ${details}` : ''}`;
  });
}

function formatValidationLines(plan = {}) {
  return asArray(plan?.validationPlan).map((item) => {
    const method = cleanText(item?.method, 120) || 'validation';
    const target = cleanText(item?.target, 240);
    const rationale = cleanText(item?.rationale, 400);
    return `- ${method}${target ? `, ${target}` : ''}${rationale ? `: ${rationale}` : ''}`;
  });
}

export function formatProteinBuilderCloningNotebookResult({
  constructName = '',
  backboneName = '',
  assembledRecord = {},
  plan = {},
  pcrProgram = {}
} = {}) {
  const lines = [
    'Protein Builder cloning assembly design',
    '',
    `Construct: ${cleanText(constructName, 160) || cleanText(assembledRecord?.name, 160) || 'Protein Builder Insert'}`,
    `Backbone: ${cleanText(backboneName, 160) || 'Stored backbone'}`,
    `Assembled construct length: ${formatBp(assembledRecord?.sequence?.length || plan?.assembledVectorDesign?.predictedResultLength)}`,
    `Recommended route: ${formatStrategyName(plan?.recommendedAssemblyStrategy)}`,
    `Primer threshold: ${cleanText(plan?.primerOligoPlan?.selectedThresholdLevel, 80) || 'not selected'}`,
    '',
    'PCR program',
    ...formatPcrProgramLines(pcrProgram),
    '',
    'Primers',
    ...formatPrimerLines(plan),
    '',
    'Assembly procedure',
    ...formatProcedureLines(plan),
    '',
    'Validation plan',
    ...formatValidationLines(plan)
  ];

  const warnings = asArray(plan?.warnings).filter(Boolean);
  if (warnings.length) {
    lines.push('', 'Warnings', ...warnings.map((warning) => `- ${warning}`));
  }
  if (plan?.alternateStrategyRecommendation) {
    lines.push('', `Alternate strategy: ${plan.alternateStrategyRecommendation}`);
  }

  return lines.filter((line, index, list) => line || list[index - 1]).join('\n').trim();
}

function formatThermocycleCondition(step = {}) {
  return [
    cleanText(step?.label, 120) || 'Thermocycle step',
    cleanText(step?.temperature, 60),
    cleanText(step?.time, 60)
  ].filter(Boolean).join(' - ');
}

export function buildProteinBuilderCloningProtocolSteps(pcrProgram = {}) {
  const programSteps = asArray(pcrProgram?.steps);
  if (!programSteps.length) {
    return [{
      id: `${CLONING_PROTOCOL_ID}_step_1`,
      text: 'Configure the thermocycler with the generated PCR program.',
      placeholders: []
    }];
  }

  const cyclingSteps = programSteps.filter((step) => Math.max(1, Number(step?.cycles) || 1) > 1);
  const singleSteps = programSteps.filter((step) => Math.max(1, Number(step?.cycles) || 1) === 1);
  const steps = singleSteps
    .filter((step) => cleanText(step?.label, 80).toLowerCase() === 'initial denaturation')
    .map((step) => formatThermocycleCondition(step));

  if (cyclingSteps.length) {
    const cycleCount = Math.max(...cyclingSteps.map((step) => Math.max(1, Number(step?.cycles) || 1)));
    steps.push(`Repeat for ${cycleCount} cycles: ${cyclingSteps.map((step) => formatThermocycleCondition(step)).join('; ')}.`);
  }

  singleSteps
    .filter((step) => cleanText(step?.label, 80).toLowerCase() !== 'initial denaturation')
    .forEach((step) => steps.push(formatThermocycleCondition(step)));

  return steps.map((text, index) => ({
    id: `${CLONING_PROTOCOL_ID}_step_${index + 1}`,
    text,
    placeholders: []
  }));
}

export function buildProteinBuilderCloningProtocol(pcrProgram = {}, nowIso = '') {
  return {
    id: CLONING_PROTOCOL_ID,
    name: CLONING_PROTOCOL_NAME,
    purpose: 'Run the generated high-fidelity PCR thermocycle program for the cloning design.',
    materials: [
      'DNA template',
      'Forward and reverse primers',
      'dNTP mix',
      'High-fidelity DNA polymerase',
      'Polymerase buffer',
      'Nuclease-free water'
    ],
    steps: buildProteinBuilderCloningProtocolSteps(pcrProgram),
    troubleshooting: 'If amplification is weak or nonspecific, adjust annealing temperature and extension time for the selected primer pair and polymerase.',
    createdAt: nowIso,
    updatedAt: nowIso,
    source: CLONING_NOTEBOOK_SOURCE
  };
}

export function resolveProteinBuilderCloningNotebookProtocol(entry = {}) {
  const design = entry?.proteinBuilderCloningDesign;
  const source = cleanText(design?.source, 80);
  const protocolId = cleanText(entry?.protocolId || entry?.protocolSnapshot?.id, 160);
  const pcrProgram = design?.pcrProgram;
  const snapshotName = cleanText(entry?.protocolSnapshot?.name, 220);
  const protocolName = cleanText(entry?.protocolName, 220);
  const hasLegacySnapshot = !entry?.protocolSnapshot
    || snapshotName === LEGACY_CLONING_PROTOCOL_NAME
    || protocolName === LEGACY_CLONING_PROTOCOL_NAME;
  if (
    (source !== CLONING_NOTEBOOK_SOURCE && protocolId !== CLONING_PROTOCOL_ID)
    || !asArray(pcrProgram?.steps).length
    || !hasLegacySnapshot
  ) {
    return null;
  }

  return buildProteinBuilderCloningProtocol(
    pcrProgram,
    cleanText(entry?.updatedAt || entry?.createdAt, 120)
  );
}

function ensureProteinBuilderProject(state, createId, nowIso) {
  state.projects = asArray(state.projects);
  const existing = state.projects.find((project) => (
    cleanText(project?.source, 80) === CLONING_NOTEBOOK_SOURCE
    || cleanText(project?.name, 160).toLowerCase() === CLONING_PROJECT_NAME.toLowerCase()
  ));
  if (existing) {
    return existing;
  }

  const project = {
    id: createStableId(createId, 'protein_builder_project'),
    name: CLONING_PROJECT_NAME,
    description: CLONING_PROJECT_DESCRIPTION,
    createdAt: nowIso,
    updatedAt: nowIso,
    source: CLONING_NOTEBOOK_SOURCE
  };
  state.projects.push(project);
  return project;
}

function ensureProteinBuilderProtocol(state, pcrProgram, nowIso) {
  state.protocols = asArray(state.protocols);
  const nextProtocol = buildProteinBuilderCloningProtocol(pcrProgram, nowIso);
  const existingIndex = state.protocols.findIndex((protocol) => (
    cleanText(protocol?.id, 160) === CLONING_PROTOCOL_ID
  ));
  if (existingIndex >= 0) {
    state.protocols[existingIndex] = {
      ...state.protocols[existingIndex],
      ...nextProtocol,
      createdAt: cleanText(state.protocols[existingIndex]?.createdAt, 120) || nextProtocol.createdAt
    };
    return state.protocols[existingIndex];
  }
  state.protocols.push(nextProtocol);
  return nextProtocol;
}

function resultTextAfterName(text) {
  const source = String(text || '').trim();
  const match = source.match(/^[^:]+:\s*(.+?)\.?$/s);
  return match ? match[1].trim() : source;
}

export function buildProteinBuilderPcrReactionCalculation(pcrProgram = {}, nowIso = '') {
  const polymerase = cleanText(pcrProgram?.polymerase, 160) || 'High-fidelity DNA polymerase';
  const result = calculateFixedReaction({
    totalVolumeValue: '50 uL',
    totalVolumeUnit: 'uL',
    fillName: 'Nuclease-free water',
    reagents: [
      { rowIndex: 1, name: 'Forward primer', stockConcentration: '10 uM', finalConcentration: '0.5 uM' },
      { rowIndex: 2, name: 'Reverse primer', stockConcentration: '10 uM', finalConcentration: '0.5 uM' },
      { rowIndex: 3, name: 'dNTP mix', stockConcentration: '10 mM', finalConcentration: '0.2 mM' },
      { rowIndex: 4, name: polymerase, manualVolumeValue: '0.5 uL' },
      { rowIndex: 5, name: '5x polymerase buffer', stockConcentration: '5x', finalConcentration: '1x' },
      { rowIndex: 6, name: 'Template DNA', manualVolumeValue: '1 uL' }
    ]
  });
  const rowsByIndex = new Map(asArray(result?.inputs?.reagents).map((row, index) => (
    [Math.max(1, Number(row?.rowIndex) || index + 1), row]
  )));
  const rows = asArray(result?.details).map((detail, index) => {
    const rowDetail = asArray(detail?.details)[0] || {};
    const rowInput = rowsByIndex.get(Math.max(1, Number(detail?.rowIndex) || index + 1)) || {};
    return [
      cleanText(rowDetail?.name || detail?.inputs?.name || rowInput?.name, 160),
      cleanText(rowInput?.stockConcentration, 80),
      cleanText(rowInput?.finalConcentration, 80),
      cleanText(rowDetail?.quantityText || resultTextAfterName(detail?.resultText), 80)
    ];
  });

  return {
    id: CLONING_REACTION_CALCULATION_ID,
    type: result.type,
    mode: result.mode,
    title: result.title,
    inputs: result.inputs,
    table: {
      caption: 'Fixed Volume Reaction',
      metaRows: [['Total volume', '50 uL', '', '']],
      headers: ['Item', 'Stock Conc.', 'Final Conc.', 'Volume'],
      rows,
      footerRows: [[result?.fill?.name || 'Nuclease-free water', '', '', result?.fill?.text || '']]
    },
    result: result.resultText,
    formula: result.formulaText,
    summary: result.resultText || result.formulaText,
    createdAt: nowIso,
    status: result.status || ''
  };
}

function appendGeneratedPcrReaction(calculations, reactionCalculation) {
  return asArray(calculations)
    .filter((calculation) => cleanText(calculation?.id, 160) !== CLONING_REACTION_CALCULATION_ID)
    .concat(reactionCalculation);
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
      placeholders: asArray(step?.placeholders).map((placeholder, placeholderIndex) => ({
        id: cleanText(placeholder?.id, 120) || `placeholder_${placeholderIndex + 1}`,
        name: cleanText(placeholder?.name, 160) || `Value ${placeholderIndex + 1}`
      }))
    }))
  };
}

export function migrateProteinBuilderCloningNotebookState(state = {}) {
  if (!state || typeof state !== 'object') {
    return 0;
  }

  let migratedCount = 0;
  let latestProtocol = null;
  state.notebookEntries = asArray(state.notebookEntries).map((entry) => {
    const protocol = resolveProteinBuilderCloningNotebookProtocol(entry);
    if (!protocol) {
      return entry;
    }
    migratedCount += 1;
    latestProtocol = protocol;
    return {
      ...entry,
      protocolId: protocol.id,
      protocolName: protocol.name,
      protocolSnapshot: cloneProtocolSnapshot(protocol)
    };
  });

  if (latestProtocol) {
    state.protocols = asArray(state.protocols);
    const protocolIndex = state.protocols.findIndex((protocol) => (
      cleanText(protocol?.id, 160) === CLONING_PROTOCOL_ID
    ));
    if (protocolIndex >= 0) {
      const existingProtocol = state.protocols[protocolIndex];
      state.protocols[protocolIndex] = {
        ...existingProtocol,
        ...latestProtocol,
        createdAt: cleanText(existingProtocol?.createdAt, 120) || latestProtocol.createdAt
      };
    } else {
      state.protocols.push(latestProtocol);
    }
  }

  return migratedCount;
}

export function createProteinBuilderCloningNotebookPage({
  state,
  persist,
  createId,
  onNotebookEntriesChanged,
  entryId: requestedEntryId = '',
  constructName = '',
  backbone = {},
  dnaConstruct = {},
  assembledRecord = {},
  plan = null
} = {}) {
  if (!state || typeof state !== 'object') {
    return null;
  }

  const cloningPlan = plan || buildProteinBuilderCloningPlan({
    backbone,
    dnaConstruct,
    assembledRecord,
    constructName
  });
  if (!cloningPlan) {
    return null;
  }

  const nowIso = new Date().toISOString();
  const project = ensureProteinBuilderProject(state, createId, nowIso);
  const pcrProgram = buildProteinBuilderPcrProgram(cloningPlan);
  const protocol = ensureProteinBuilderProtocol(state, pcrProgram, nowIso);
  const backboneName = buildBackboneName(backbone);
  const safeConstructName = cleanText(constructName, 160)
    || cleanText(assembledRecord?.name, 160)
    || 'Protein Builder Insert';
  const result = formatProteinBuilderCloningNotebookResult({
    constructName: safeConstructName,
    backboneName,
    assembledRecord,
    plan: cloningPlan,
    pcrProgram
  });
  const resultTable = buildProteinBuilderPrimerResultTable(cloningPlan);
  state.notebookEntries = asArray(state.notebookEntries);
  const entryId = cleanText(requestedEntryId, 160) || createStableId(createId, 'protein_builder_cloning_entry');
  const existingEntryIndex = state.notebookEntries.findIndex((candidate) => (
    cleanText(candidate?.id, 160) === entryId
  ));
  const existingEntry = existingEntryIndex >= 0 ? state.notebookEntries[existingEntryIndex] : null;
  const entry = {
    id: entryId,
    notebookType: 'biology',
    projectId: project.id,
    projectName: project.name,
    protocolId: protocol.id,
    protocolName: protocol.name,
    experimentName: `${safeConstructName} cloning primer design`,
    protocolSnapshot: cloneProtocolSnapshot(protocol),
    values: {},
    result,
    resultTable,
    resultTables: resultTable ? [resultTable] : [],
    toolCalculations: appendGeneratedPcrReaction(
      existingEntry?.toolCalculations,
      buildProteinBuilderPcrReactionCalculation(pcrProgram, nowIso)
    ),
    resultFiles: [],
    resultFileRecords: [],
    storageFolder: '',
    updatedAt: nowIso,
    createdAt: cleanText(existingEntry?.createdAt, 120) || nowIso,
    notebookState: cleanText(existingEntry?.notebookState, 80) || 'planned',
    executedAt: '',
    agentDraftStatus: '',
    agentDraftMeta: {},
    selectionInsights: [],
    proteinBuilderCloningDesign: {
      source: CLONING_NOTEBOOK_SOURCE,
      constructName: safeConstructName,
      backboneName,
      assembledRecordName: cleanText(assembledRecord?.name, 160),
      assembledLength: Math.max(0, Number(assembledRecord?.sequence?.length) || 0),
      insertLength: Math.max(0, Number(dnaConstruct?.length || dnaConstruct?.sequence?.length) || 0),
      recommendedAssemblyStrategy: cloningPlan.recommendedAssemblyStrategy,
      primerCount: Math.max(0, Number(cloningPlan?.primerOligoPlan?.primerCount) || asArray(cloningPlan?.primerOligoPlan?.primers).length),
      pcrProgram
    }
  };

  if (existingEntryIndex >= 0) {
    state.notebookEntries[existingEntryIndex] = {
      ...existingEntry,
      ...entry
    };
  } else {
    state.notebookEntries.push(entry);
  }
  if (typeof persist === 'function') {
    persist();
  }
  if (typeof onNotebookEntriesChanged === 'function') {
    onNotebookEntriesChanged();
  }

  return {
    entry,
    project,
    protocol,
    plan: cloningPlan,
    pcrProgram
  };
}
