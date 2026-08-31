import { asArray } from '../../lib/normalize.js';
import { isPrimerBindingFeature } from './feature-types.js';
import { withPrimerFeaturesInGenbankText } from './genbank-primer-splice.js';
import { parseInputRecords } from './parsing.js';
import { PRIMER_FEATURE_SOURCE, withPrimerBindFeatures } from './primer-annotation.js';
import { LIBRARY_STATUS_TEMPORARY } from './runtime/config.js';
import { cleanText, normalizeRecordName, normalizeTopology } from './shared.js';
import { buildRecordGenbankText } from './storage.js';

// Confirming a design commits the working edit: the post-cloning plasmid gets
// its own GenBank entry, and the designed primers are annotated on it and on
// the parent it was cloned from. Both writes go through the bridge directly so
// that saving the parent never steals the viewer's active entry.

// withPrimerBindFeatures replaces the sites it wrote by looking for its own
// source marker, but a record that has been through a GenBank round-trip has
// lost it. Drop same-named primer sites first so re-confirming a design updates
// them instead of stacking duplicates.
function withoutPrimerSitesNamed(record, primers) {
  const names = new Set(asArray(primers)
    .map((primer) => cleanText(primer?.name, 160).toLowerCase())
    .filter(Boolean));
  return {
    ...record,
    features: asArray(record?.features).filter((feature) => !(
      isPrimerBindingFeature(feature?.type)
      && names.has(cleanText(feature?.name, 160).toLowerCase())
    ))
  };
}

// A mutagenic primer matches the parent nowhere -- carrying the edit is the
// whole point of it -- so a search for its sequence cannot find it there. Its
// footprint is still known exactly: the site it took on the product, mapped
// back through the edit. The viewer then draws the mutated bases as the
// unannealed bulge they are.
function buildEditIndexMapper(source = {}) {
  const editStart = Math.max(0, Math.round(Number(source?.editedRange?.start) || 0));
  const editEnd = Math.max(editStart, Math.round(Number(source?.editedRange?.end) || 0));
  const originalStart = Math.max(0, Math.round(Number(source?.originalRange?.start) || 0));
  const originalEnd = Math.max(originalStart, Math.round(Number(source?.originalRange?.end) || 0));
  const delta = (originalEnd - originalStart) - (editEnd - editStart);
  return (index) => {
    const safeIndex = Math.max(0, Math.round(Number(index) || 0));
    if (safeIndex <= editStart) {
      return safeIndex;
    }
    return safeIndex >= editEnd ? safeIndex + delta : editStart;
  };
}

function mapProductPrimersOntoParent({ source, productFeatures, missingNames, parentLength, usedIds }) {
  if (!missingNames.size || !Number(source?.editedRange?.end)) {
    return [];
  }
  const mapIndex = buildEditIndexMapper(source);
  return asArray(productFeatures)
    .filter((feature) => missingNames.has(cleanText(feature?.name, 160).toLowerCase()))
    .map((feature) => {
      const segments = asArray(feature?.segments)
        .map((segment) => ({
          start: Math.min(mapIndex(segment?.start), parentLength),
          end: Math.min(mapIndex(segment?.end), parentLength)
        }))
        .filter((segment) => segment.end > segment.start);
      if (!segments.length) {
        return null;
      }
      let id = `${feature.id}_on_parent`;
      while (usedIds.has(id)) {
        id = `${id}_1`;
      }
      usedIds.add(id);
      return {
        ...feature,
        id,
        source: PRIMER_FEATURE_SOURCE,
        description: [feature.description, 'binds with mismatches here'].filter(Boolean).join(' | '),
        segments
      };
    })
    .filter(Boolean);
}

async function upsertRecord(bridge, storagePath, record, {
  id = '',
  name,
  status,
  alignmentSessions,
  gbkText: providedGbkText = ''
} = {}) {
  // A file that already exists is spliced, not regenerated; only a brand new
  // record is serialised from scratch.
  const gbkText = providedGbkText || buildRecordGenbankText(record);
  if (!gbkText.trim()) {
    throw new Error('Failed to generate GenBank text for the sequence entry.');
  }
  const response = await bridge.sequenceLibraryUpsert({
    storagePath,
    id: cleanText(id, 200),
    name: normalizeRecordName(name || record?.name, 'sequence'),
    status,
    sourceFormat: String(record?.sourceFormat || ''),
    topology: normalizeTopology(record?.topology || 'linear'),
    sequenceLength: record.sequence.length,
    featureCount: asArray(record?.features).length,
    sequence: record.sequence,
    features: asArray(record?.features),
    gbkText,
    alignmentSessions: Array.isArray(alignmentSessions) ? alignmentSessions : undefined
  });
  if (!response?.ok || !response?.entry) {
    throw new Error(response?.error || 'Failed to save the sequence entry.');
  }
  return response.entry;
}

// The parent keeps its own id, name, status and alignments: only its feature
// list grows. A parent that cannot be read is reported rather than thrown, so a
// missing or unsaved parent never costs the user the product file.
async function annotateParentPlasmid({ bridge, storagePath, parentEntryId, primers, source, productFeatures }) {
  if (!parentEntryId || !bridge?.sequenceLibraryGet) {
    return { entry: null, placed: 0, unplaced: [], error: '' };
  }
  try {
    const stored = await bridge.sequenceLibraryGet({
      storagePath,
      id: parentEntryId,
      includeGbk: true,
      includeAlignments: true
    });
    if (!stored?.ok || !stored?.entry) {
      throw new Error(stored?.error || 'The parent plasmid is no longer in the library.');
    }
    const parsed = parseInputRecords(String(stored.gbkText || ''));
    const parentRecord = asArray(parsed?.records)[0];
    if (!parentRecord?.sequence?.length) {
      throw new Error('The parent plasmid holds no readable sequence.');
    }
    const annotated = withPrimerBindFeatures(withoutPrimerSitesNamed(parentRecord, primers), primers);
    // Whatever could not be found by sequence is placed from the product instead.
    const missingNames = new Set([...annotated.unplaced, ...annotated.ambiguous.map((entry) => entry.name)]
      .map((name) => cleanText(name, 160).toLowerCase())
      .filter(Boolean));
    const mapped = mapProductPrimersOntoParent({
      source,
      productFeatures,
      missingNames,
      parentLength: parentRecord.sequence.length,
      usedIds: new Set(annotated.features.map((feature) => cleanText(feature?.id, 200)))
    });
    const added = [...annotated.added, ...mapped];
    const unplaced = annotated.unplaced
      .filter((name) => !mapped.some((feature) => feature.name === name));
    // The parent keeps its own file byte for byte apart from the primer sites.
    // If it is not a GenBank record the splice understands, the annotation is
    // skipped rather than silently rewriting the user's file.
    const gbkText = withPrimerFeaturesInGenbankText(
      stored.gbkText,
      added,
      parentRecord.sequence.length
    );
    if (!gbkText) {
      throw new Error('The parent plasmid file could not be annotated without rewriting it.');
    }
    const entry = await upsertRecord(
      bridge,
      storagePath,
      { ...parentRecord, features: [...annotated.features, ...mapped] },
      {
        id: parentEntryId,
        name: stored.entry.name || parentRecord.name,
        status: stored.entry.status,
        alignmentSessions: asArray(stored.alignments),
        gbkText
      }
    );
    return { entry, placed: added.length, unplaced, error: '' };
  } catch (error) {
    return {
      entry: null,
      placed: 0,
      unplaced: [],
      error: cleanText(error?.message || error, 300) || 'Unknown error.'
    };
  }
}

export async function confirmCloningDesign({
  record,
  source,
  primers,
  bridge,
  storagePath,
  productName = ''
} = {}) {
  const designedPrimers = asArray(primers);
  if (!record?.sequence?.length) {
    throw new Error('Load a sequence before confirming the design.');
  }
  if (!designedPrimers.length) {
    throw new Error('Design primers before confirming the design.');
  }
  if (!cleanText(storagePath, 2000)) {
    throw new Error('Set Storage Folder Path in Settings before confirming a design.');
  }
  if (!bridge?.sequenceLibraryUpsert) {
    throw new Error('Sequence library storage API unavailable.');
  }

  const product = withPrimerBindFeatures(withoutPrimerSitesNamed(record, designedPrimers), designedPrimers);
  const productRecord = {
    ...record,
    // The open record's own name wins: it is what the viewer shows, and it
    // survives a manual rename that the generated design name would not.
    name: normalizeRecordName(productName || record.name || source?.recordName, 'sequence'),
    features: product.features
  };
  // No id is passed: the post-cloning plasmid is always a new file, never an
  // overwrite of the record the design started from. It lands unsaved, so
  // confirming a design still leaves the keep-or-discard call to the user.
  const productEntry = await upsertRecord(bridge, storagePath, productRecord, {
    name: productRecord.name,
    status: LIBRARY_STATUS_TEMPORARY
  });

  const parent = await annotateParentPlasmid({
    bridge,
    storagePath,
    parentEntryId: cleanText(source?.parentEntryId, 200),
    primers: designedPrimers,
    source,
    productFeatures: product.added
  });

  return {
    primerCount: designedPrimers.length,
    productEntry,
    productRecord,
    productPlaced: product.added.length,
    productUnplaced: product.unplaced,
    parentEntry: parent.entry,
    parentPlaced: parent.placed,
    parentUnplaced: parent.unplaced,
    parentError: parent.error
  };
}

// One sentence for the toolbar: what was written, and what could not be placed.
export function describeCloningDesignConfirmation(result = {}) {
  const productName = result?.productEntry?.name || 'the cloned plasmid';
  const parts = [
    `Created ${productName} with ${result.productPlaced} of ${result.primerCount} primers annotated.`,
    'Use Save to keep it in the library.'
  ];
  if (result.parentEntry) {
    parts.push(`Annotated ${result.parentPlaced} on ${result.parentEntry.name}.`);
  } else if (result.parentError) {
    parts.push(`The parent plasmid was not updated: ${result.parentError}`);
  }
  const unplaced = asArray(result.productUnplaced);
  if (unplaced.length) {
    parts.push(`No binding site on the product for ${unplaced.join(', ')}.`);
  }
  return parts.join(' ');
}
