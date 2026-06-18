import { assembleCloningPlan } from '../tool-box/cloning-assembly.js';
import { cleanText, normalizeSequenceText } from './shared.js';

const CLONING_NOTEBOOK_SOURCE = 'protein_builder_cloning_assembly';
const CLONING_PROJECT_NAME = 'Protein Builder';
const CLONING_PROJECT_DESCRIPTION = 'Automatically collected cloning designs from Protein Builder.';
const CLONING_PROTOCOL_ID = 'protein-builder-cloning-assembly-protocol';
const CLONING_PROTOCOL_NAME = 'Protein Builder Cloning Assembly';

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

function clampTemperature(value, min = 50, max = 68) {
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

  return assembleCloningPlan({
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
}

export function buildProteinBuilderPcrProgram(plan = {}) {
  const primers = asArray(plan?.primerOligoPlan?.primers);
  const primerTms = primers
    .map((primer) => Number(primer?.tm))
    .filter((tm) => Number.isFinite(tm) && tm > 0);
  const lowestPrimerTm = primerTms.length ? Math.min(...primerTms) : 60;
  const annealingTemperature = clampTemperature(lowestPrimerTm - 3);
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
      `Annealing temperature is estimated from the lowest primer binding Tm (${formatNumber(lowestPrimerTm, 1)} C) minus 3 C.`,
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
    notes: asArray(primer?.warnings).filter(Boolean).join(' | ')
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
    const notes = asArray(primer?.warnings).filter(Boolean).join(' ');
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

function buildProtocolSteps(plan = {}) {
  const procedureSteps = asArray(plan?.stepByStepProcedure);
  if (procedureSteps.length) {
    return procedureSteps.map((step, index) => ({
      id: `${CLONING_PROTOCOL_ID}_step_${index + 1}`,
      text: `${cleanText(step?.title, 160) || `Step ${index + 1}`}: ${cleanText(step?.details, 800) || 'Follow the planned cloning step.'}`,
      placeholders: []
    }));
  }

  return [
    {
      id: `${CLONING_PROTOCOL_ID}_step_1`,
      text: 'Review Protein Builder cloning inputs and primer plan.',
      placeholders: []
    }
  ];
}

function buildCloningProtocol(plan = {}, nowIso = '') {
  return {
    id: CLONING_PROTOCOL_ID,
    name: CLONING_PROTOCOL_NAME,
    purpose: 'Design cloning primers and PCR setup for a Protein Builder assembled construct.',
    materials: [
      'Protein Builder insert DNA template',
      'Selected vector backbone template',
      'Designed primers',
      'High-fidelity DNA polymerase'
    ],
    steps: buildProtocolSteps(plan),
    troubleshooting: 'If primer design is infeasible, adjust the selected backbone, fragment order, or assembly strategy.',
    createdAt: nowIso,
    updatedAt: nowIso,
    source: CLONING_NOTEBOOK_SOURCE
  };
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

function ensureProteinBuilderProtocol(state, plan, nowIso) {
  state.protocols = asArray(state.protocols);
  const nextProtocol = buildCloningProtocol(plan, nowIso);
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
  const protocol = ensureProteinBuilderProtocol(state, cloningPlan, nowIso);
  const pcrProgram = buildProteinBuilderPcrProgram(cloningPlan);
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
