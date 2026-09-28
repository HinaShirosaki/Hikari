import { cleanText, formatThermocycleCondition } from '../shared.js';
import { asArray } from '../../../lib/normalize.js';
import { CLONING_NOTEBOOK_SOURCE, CLONING_PROJECT_DESCRIPTION, CLONING_PROJECT_NAME, CLONING_PROTOCOL_ID, CLONING_PROTOCOL_NAME } from './constants.js';
import { createStableId } from './pcr-programs.js';

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
  }).map((text) => ({
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
    steps: asArray(protocol?.steps).map((step) => ({
      text: cleanText(step?.text, 1200),
      placeholders: []
    }))
  };
}

function ensureProject(ensureProjectRecord, createId, nowIso) {
  const project = {
    id: createStableId(createId, 'sequence_viewer_project'),
    name: CLONING_PROJECT_NAME,
    description: CLONING_PROJECT_DESCRIPTION,
    createdAt: nowIso,
    updatedAt: nowIso,
    source: CLONING_NOTEBOOK_SOURCE
  };
  return ensureProjectRecord?.(project) || project;
}

function ensureProtocol(saveProtocolRecord, pcrPrograms, nowIso) {
  const protocol = buildProtocol(pcrPrograms, nowIso);
  return saveProtocolRecord?.(protocol, { preserveCreatedAt: true }) || protocol;
}

export {
  cloneProtocolSnapshot,
  ensureProject,
  ensureProtocol
};
