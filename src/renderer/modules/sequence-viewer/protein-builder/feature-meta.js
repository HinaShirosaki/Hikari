import { sanitizeProteinAssemblySequence } from '../../tool-box/protein-assembly.js';
import { buildFeatureDerivedSequence } from './sequence-utils.js';
import { formatCount } from './row-factory.js';

export function buildFeatureResultMeta(feature) {
  const hostCount = Math.max(0, Number(feature?.hostCount) || 0);
  const derived = buildFeatureDerivedSequence(feature);
  const aaLength = sanitizeProteinAssemblySequence(derived.sequence, true).length;
  const sourceLength = Math.max(0, Number(feature?.sequenceLength) || String(derived.sourceSequence || '').length);
  const lengthText = derived.mode === 'translated'
    ? `${sourceLength} nt -> ${aaLength} aa`
    : `${aaLength} aa`;
  return {
    ...derived,
    lengthText,
    hostText: formatCount(hostCount, 'vector')
  };
}
