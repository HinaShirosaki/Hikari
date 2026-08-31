import { DEFAULT_CLONING_PREFERENCES } from './constants.js';
import { normalizeSequence } from './sequence-utils.js';
import { normalizeHostVector } from './fragments.js';
import { normalizeEditRequest } from './edit-map.js';

export function evaluateSiteDirectedMutagenesis(args = {}) {
  const config = {
    ...DEFAULT_CLONING_PREFERENCES,
    ...(args?.config || args?.preferences || {})
  };
  const host = args?.host ? normalizeHostVector(args.host, 0) : null;
  const templateSequence = host?.sequence || normalizeSequence(args?.resultSequence || '');
  const normalizedEdit = normalizeEditRequest(args?.editRequest, templateSequence);

  if (!normalizedEdit) {
    return {
      feasible: false,
      warnings: ['No supported edit request was provided.'],
      reason: 'Edit request is missing or unsupported.'
    };
  }

  const changedNt = normalizedEdit.type === 'replacement'
    ? Math.max(normalizedEdit.originalSequence.length, normalizedEdit.editedSequence.length)
    : Math.max(Math.abs(normalizedEdit.editedSequence.length - normalizedEdit.originalSequence.length), normalizedEdit.editedSequence.length);
  const aminoAcidDelta = changedNt / 3;
  const feasible = Boolean(templateSequence.length)
    && host?.topology !== 'linear'
    && aminoAcidDelta <= (Number(config?.maxPrimerEncodedInsertionAA) || DEFAULT_CLONING_PREFERENCES.maxPrimerEncodedInsertionAA);

  return {
    feasible,
    editType: normalizedEdit.type,
    deltaLength: normalizedEdit.editedSequence.length - normalizedEdit.originalSequence.length,
    aminoAcidDelta,
    start: normalizedEdit.start,
    end: normalizedEdit.end,
    requiresTiling: normalizedEdit.editedSequence.length > Math.max(0, Number(config?.maxPrimerLength) || DEFAULT_CLONING_PREFERENCES.maxPrimerLength),
    warnings: feasible
      ? []
      : [host?.topology === 'linear'
          ? 'Whole-plasmid mutagenesis requires a circular plasmid template.'
          : 'The requested edit exceeds the configured size cap for primer-driven mutagenesis.'],
    reason: feasible
      ? 'The requested local edit is suitable for primer-driven mutagenesis on the selected template.'
      : (host?.topology === 'linear'
          ? 'The selected template is linear, so a whole-plasmid mutagenesis route cannot circularise the product as designed.'
          : 'The requested edit is too large or lacks a usable template sequence for site-directed mutagenesis.')
  };
}
