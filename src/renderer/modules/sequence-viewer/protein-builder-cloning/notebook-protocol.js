import { cleanText } from '../shared.js';
import { asArray } from '../../../lib/normalize.js';
import { CLONING_NOTEBOOK_SOURCE, CLONING_PROJECT_DESCRIPTION, CLONING_PROJECT_NAME, CLONING_PROTOCOL_ID, CLONING_PROTOCOL_NAME, LEGACY_CLONING_PROTOCOL_NAME } from './constants.js';
import { createStableId } from './formatting.js';

function formatThermocycleCondition(step = {}) {
  return [
    cleanText(step?.label, 120) || 'Thermocycle step',
    cleanText(step?.temperature, 60),
    cleanText(step?.time, 60)
  ].filter(Boolean).join(' - ');
}

function buildProteinBuilderCloningProtocolSteps(pcrProgram = {}) {
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

function buildProteinBuilderCloningProtocol(pcrProgram = {}, nowIso = '') {
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

function resolveProteinBuilderCloningNotebookProtocol(entry = {}) {
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

function migrateProteinBuilderCloningNotebookState(state = {}) {
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

export {
  buildProteinBuilderCloningProtocol,
  buildProteinBuilderCloningProtocolSteps,
  cloneProtocolSnapshot,
  ensureProteinBuilderProject,
  ensureProteinBuilderProtocol,
  migrateProteinBuilderCloningNotebookState,
  resolveProteinBuilderCloningNotebookProtocol
};
