import {
  appendGeneratedPcrReaction,
  buildFixedReactionCalculation
} from './pcr-reaction-setup.js';
import { cleanText } from './shared.js';
import { asArray } from '../../lib/normalize.js';

// One notebook page per downstream cloning reaction. The PCR page carries the
// thermocycle program; a digest, a ligation, a KLD or a one-pot assembly is its
// own bench session, so each gets its own page, protocol and fixed-volume tube.

const STEP_PREFIX = 'cloning-reaction';

// An executed page is a bench record of what actually happened. Regenerating a
// design must never write over one: it gets a fresh planned page instead.
export function isExecutedNotebookEntry(entry) {
  return cleanText(entry?.notebookState, 80) === 'executed';
}

function fallbackId(prefix = 'id') {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function stableId(createId, prefix) {
  const created = typeof createId === 'function' ? createId() : '';
  return cleanText(created, 120) || fallbackId(prefix);
}

function uniqueEntryId(state, createId, prefix) {
  const used = new Set(asArray(state?.notebookEntries).map((entry) => cleanText(entry?.id, 160)).filter(Boolean));
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const candidate = stableId(createId, prefix);
    if (!used.has(candidate)) {
      return candidate;
    }
  }
  let candidate = fallbackId(prefix);
  while (used.has(candidate)) {
    candidate = fallbackId(prefix);
  }
  return candidate;
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

function buildStepProtocol(step, source, nowIso) {
  const stepId = cleanText(step?.id, 80);
  return {
    id: `${STEP_PREFIX}-${stepId}-protocol`,
    name: cleanText(step?.name, 220) || 'Cloning Reaction',
    purpose: cleanText(step?.purpose, 1000),
    materials: asArray(step?.materials).map((material) => cleanText(material, 160)).filter(Boolean),
    steps: asArray(step?.steps).map((text, index) => ({
      id: `${STEP_PREFIX}_${stepId}_step_${index + 1}`,
      text: cleanText(text, 1200),
      placeholders: []
    })),
    createdAt: nowIso,
    updatedAt: nowIso,
    source
  };
}

function buildStepResult(step, subjectName) {
  return [
    `${cleanText(step?.name, 220) || 'Cloning reaction'} for ${subjectName || 'this design'}`,
    cleanText(step?.purpose, 1000),
    `Reaction volume: ${cleanText(step?.totalVolume, 40) || '50 uL'} (see the fixed volume reaction table).`,
    ''
  ].join('\n');
}

export function syncCloningReactionStepPages({
  state,
  createId,
  nowIso = '',
  project,
  source = '',
  pageKey = '',
  subjectName = '',
  strategy = '',
  steps = []
} = {}) {
  if (!state || typeof state !== 'object' || !cleanText(pageKey, 160)) {
    return [];
  }
  const wanted = asArray(steps);
  const wantedIds = new Set(wanted.map((step) => cleanText(step?.id, 80)));
  const owns = (candidate) => (
    cleanText(candidate?.cloningReactionStep?.source, 80) === cleanText(source, 80)
    && cleanText(candidate?.cloningReactionStep?.pageKey, 160) === cleanText(pageKey, 160)
  );
  // Switching route leaves the previous one's reactions behind, and a ligation
  // page under a Gibson design is worse than no page. Only untouched,
  // still-planned pages are dropped.
  state.notebookEntries = asArray(state.notebookEntries).filter((candidate) => !(
    owns(candidate)
    && !wantedIds.has(cleanText(candidate?.cloningReactionStep?.stepId, 80))
    && !isExecutedNotebookEntry(candidate)
  ));

  return wanted.map((step, index) => {
    const stepId = cleanText(step?.id, 80);
    const protocol = upsertProtocol(state, buildStepProtocol(step, source, nowIso), nowIso);
    const existingEntry = state.notebookEntries.find((candidate) => (
      owns(candidate)
      && cleanText(candidate?.cloningReactionStep?.stepId, 80) === stepId
      && !isExecutedNotebookEntry(candidate)
    )) || null;
    const generatedCalculation = buildFixedReactionCalculation({
      id: `${STEP_PREFIX}-${stepId}-fixed-reaction`,
      totalVolume: step?.totalVolume,
      reagents: step?.reagents,
      reactionLabels: step?.reactionLabels,
      nowIso
    });
    const entry = {
      id: cleanText(existingEntry?.id, 160) || uniqueEntryId(state, createId, `cloning_${stepId}_entry`),
      notebookType: 'biology',
      projectId: project?.id,
      projectName: project?.name,
      protocolId: protocol.id,
      protocolName: protocol.name,
      experimentName: `${subjectName} ${cleanText(step?.name, 220) || 'cloning reaction'}`.trim(),
      protocolSnapshot: {
        id: protocol.id,
        name: protocol.name,
        category: cleanText(protocol.category, 120),
        purpose: protocol.purpose,
        steps: asArray(protocol.steps).map((protocolStep) => ({
          id: protocolStep.id,
          text: protocolStep.text,
          placeholders: []
        }))
      },
      values: existingEntry?.values && typeof existingEntry.values === 'object'
        ? { ...existingEntry.values }
        : {},
      result: buildStepResult(step, subjectName),
      resultTable: existingEntry?.resultTable || null,
      resultTables: asArray(existingEntry?.resultTables),
      toolCalculations: appendGeneratedPcrReaction(existingEntry?.toolCalculations, generatedCalculation),
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
      cloningReactionStep: {
        source: cleanText(source, 80),
        pageKey: cleanText(pageKey, 160),
        stepId,
        stepIndex: index + 1,
        subjectName: cleanText(subjectName, 160),
        strategy: cleanText(strategy, 80)
      }
    };
    const existingIndex = state.notebookEntries.findIndex((candidate) => cleanText(candidate?.id, 160) === entry.id);
    if (existingIndex >= 0) {
      state.notebookEntries[existingIndex] = { ...existingEntry, ...entry };
    } else {
      state.notebookEntries.push(entry);
    }
    return entry;
  });
}
