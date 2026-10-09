import { assembleCloningPlan } from '../cloning-assembly.js';
import { assignPrimerTemplateEntries } from '../primer-template-routing.js';
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

// The shared assembly designer can distribute this gap over two neighboring
// primers. Their annealing windows and overlap still have to fit its budgets.
const MAX_PRIMER_ENCODED_PART_LENGTH = 60;

function proteinPartTemplate(part = {}) {
  return normalizeSequenceText(
    part?.templateSequence
    || part?.sourceTemplateSequence
    || part?.sourceDnaSequence
    || ''
  );
}

// Preserve one physical source per fragment. A construct assembled from two
// donor plasmids must yield two PCR fragments instead of pretending that the
// longest donor contains the complete concatenated insert. Short untemplated
// tags/linkers can ride on the next primer; longer generated blocks are built
// from overlapping oligos within the selected assembly route.
function buildProteinInsertFragments(dnaConstruct = {}, constructName = 'Protein Builder Insert') {
  const desiredSequence = normalizeSequenceText(dnaConstruct?.sequence || '');
  const parts = asArray(dnaConstruct?.parts)
    .map((part, index) => ({
      index,
      label: cleanText(part?.label, 160) || `Part ${index + 1}`,
      sequence: normalizeSequenceText(part?.dnaSequence || ''),
      templateSequence: proteinPartTemplate(part),
      templateName: cleanText(part?.templateName, 160),
      templateEntryId: cleanText(part?.templateEntryId, 200),
      templateHostSequence: normalizeSequenceText(part?.templateHostSequence || '')
    }))
    .filter((part) => part.sequence.length);
  if (!desiredSequence.length) {
    return [];
  }
  if (!parts.length) {
    return [{
      id: 'protein_builder_insert_1',
      name: constructName,
      type: 'insert',
      sequence: desiredSequence,
      metadata: { source: 'oligo_assembly', partCount: 0 }
    }];
  }
  const declaredLength = parts.reduce((sum, part) => sum + part.sequence.length, 0);
  if (declaredLength === desiredSequence.length) {
    let offset = 0;
    parts.forEach((part) => {
      part.sequence = desiredSequence.slice(offset, offset + part.sequence.length);
      offset += part.sequence.length;
    });
  }

  const templatedParts = parts.filter((part) => part.templateSequence.length);
  if (templatedParts.length) {
    const anchored = [];
    let cursor = 0;
    let anchorsValid = true;
    templatedParts.forEach((part) => {
      if (!anchorsValid) {
        return;
      }
      const templateStart = desiredSequence.indexOf(part.sequence, cursor);
      if (templateStart < 0) {
        anchorsValid = false;
        return;
      }
      const prefix = desiredSequence.slice(cursor, templateStart);
      if (prefix.length > MAX_PRIMER_ENCODED_PART_LENGTH) {
        anchored.push({
          name: 'Insert block',
          sequence: prefix,
          metadata: { source: 'oligo_assembly', templateName: 'Oligo assembly product' }
        });
      }
      anchored.push({
        name: part.label,
        sequence: `${prefix.length <= MAX_PRIMER_ENCODED_PART_LENGTH ? prefix : ''}${part.sequence}`,
        metadata: {
          source: 'protein_builder_template',
          templateSequence: part.templateSequence,
          templateName: part.templateName,
          templateEntryId: part.templateEntryId,
          specificitySequence: part.templateHostSequence || part.templateSequence,
          specificityCircular: Boolean(part.templateHostSequence)
        }
      });
      cursor = templateStart + part.sequence.length;
    });
    if (anchorsValid) {
      const suffix = desiredSequence.slice(cursor);
      if (suffix.length && suffix.length <= MAX_PRIMER_ENCODED_PART_LENGTH) {
        anchored[anchored.length - 1].sequence += suffix;
      } else if (suffix.length) {
        anchored.push({
          name: 'Insert block',
          sequence: suffix,
          metadata: { source: 'oligo_assembly', templateName: 'Oligo assembly product' }
        });
      }
      return anchored.map((fragment, index) => ({
        id: `protein_builder_insert_${index + 1}`,
        name: fragment.metadata.source === 'oligo_assembly' ? `Insert block ${index + 1}` : fragment.name,
        type: 'insert',
        sequence: fragment.sequence,
        metadata: { ...fragment.metadata, partCount: parts.length }
      }));
    }
  }

  // No usable anchor: either no part names a physical template, or a templated
  // part does not sit where the construct says it does. Both mean the parts no
  // longer describe the sequence being built, so prepare the complete insert
  // from overlapping oligos before the selected cloning reaction.
  return [{
    id: 'protein_builder_insert_1',
    name: constructName,
    type: 'insert',
    sequence: desiredSequence,
    metadata: { source: 'oligo_assembly', partCount: parts.length, templateName: 'Oligo assembly product' }
  }];
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
  const primerLengths = new Map(asArray(plan?.primerOligoPlan?.primers)
    .filter((primer) => primer.templateId && primer.ampliconLength)
    .map((primer) => [primer.templateId, primer.ampliconLength]));
  const fragments = asArray(plan?.orderedFragmentMap?.fragments)
    .map((fragment) => ({
      name: cleanText(fragment?.name, 160) || cleanText(fragment?.id, 120) || 'Fragment',
      role: cleanText(fragment?.role || fragment?.type, 80).toLowerCase(),
      length: Math.max(0, Number(primerLengths.get(fragment.id) || fragment?.sequence?.length || fragment?.length) || 0)
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
  constructName = '',
  strategy = '',
  preferences = {}
} = {}) {
  const rawBackboneSequence = normalizeSequenceText(backbone?.backboneSequence || '');
  const backboneSequence = linearizeBackboneAtInsertionOffset(rawBackboneSequence, backbone);
  const insertSequence = normalizeSequenceText(dnaConstruct?.sequence || '');
  const resultSequence = normalizeSequenceText(assembledRecord?.sequence || '');
  const safeConstructName = cleanText(constructName, 160)
    || cleanText(assembledRecord?.name, 160)
    || 'Protein Builder Insert';
  const backboneName = buildBackboneName(backbone);

  if (!backboneSequence.length || !insertSequence.length) {
    return null;
  }
  const insertFragments = buildProteinInsertFragments(dnaConstruct, safeConstructName);

  const plan = assembleCloningPlan({
    strategy,
    hostVectors: [
      {
        id: 'protein_builder_backbone',
        name: backboneName,
        topology: cleanText(backbone?.topology, 40).toLowerCase() === 'linear' ? 'linear' : 'circular',
        sequence: backboneSequence
      }
    ],
    hostVectorId: 'protein_builder_backbone',
    fragments: insertFragments,
    resultSequence,
    preferences: { ...resolveBackboneCloningPreferences(backbone), ...preferences }
  });

  if (plan?.primerOligoPlan?.primers) {
    plan.primerOligoPlan.primers = renamePrimers(assignPrimerTemplateEntries(plan.primerOligoPlan.primers, {
      fragments: plan.orderedFragmentMap.fragments,
      parentEntryId: backbone.entryId || backbone.hostVectorId
    }), {
      targetLabel: safeConstructName,
      tags: terminalTagLabels(dnaConstruct),
      backboneNames: [backboneName]
    });
  }
  return plan;
}

export {
  buildBackboneName,
  buildProteinInsertFragments,
  buildProteinBuilderCloningPlan,
  resolvePcrTargets
};
