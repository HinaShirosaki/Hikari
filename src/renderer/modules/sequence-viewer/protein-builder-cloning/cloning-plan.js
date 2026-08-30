import { assembleCloningPlan } from '../cloning-assembly.js';
import { PROTEIN_ASSEMBLY_TAGS } from '../protein-builder/assembly-model.js';
import { renamePrimers } from '../primer-naming.js';
import { cleanText, normalizeSequenceText } from '../shared.js';
import { asArray } from '../../../lib/normalize.js';

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

// The longest part template stands in for the insert's own template, and it
// carries the vector it came from: that plasmid is the PCR tube, so primer
// specificity has to be judged over all of it.
function resolveDnaConstructTemplate(dnaConstruct = {}) {
  const empty = { sequence: '', name: '', hostSequence: '' };
  if (!normalizeSequenceText(dnaConstruct?.sequence || '').length) {
    return empty;
  }

  return asArray(dnaConstruct?.parts)
    .map((part) => ({
      sequence: normalizeSequenceText(
        part?.templateSequence
        || part?.sourceTemplateSequence
        || part?.sourceDnaSequence
        || ''
      ),
      name: cleanText(part?.templateName, 160),
      hostSequence: normalizeSequenceText(part?.templateHostSequence || '')
    }))
    .filter((entry) => entry.sequence.length)
    .sort((left, right) => right.sequence.length - left.sequence.length)[0] || empty;
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

function buildProteinBuilderCloningPlan({
  backbone = {},
  dnaConstruct = {},
  assembledRecord = {},
  constructName = ''
} = {}) {
  const rawBackboneSequence = normalizeSequenceText(backbone?.backboneSequence || '');
  const backboneSequence = linearizeBackboneAtInsertionOffset(rawBackboneSequence, backbone);
  const insertSequence = normalizeSequenceText(dnaConstruct?.sequence || '');
  const insertTemplate = resolveDnaConstructTemplate(dnaConstruct);
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
          templateSequence: insertTemplate.sequence,
          templateName: insertTemplate.name,
          // Uniqueness is judged over the whole source plasmid, since that is
          // the DNA in the tube.
          specificitySequence: insertTemplate.hostSequence,
          specificityCircular: Boolean(insertTemplate.hostSequence)
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

export {
  buildBackboneName,
  buildProteinBuilderCloningPlan,
  resolvePcrTargets
};
