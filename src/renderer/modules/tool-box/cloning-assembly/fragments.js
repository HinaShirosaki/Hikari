import { reverseComplementDna } from '../sequence.js';
import { DEFAULT_CLONING_PREFERENCES } from './constants.js';
import {
  buildStableFragmentId,
  normalizeOrientation,
  normalizeSequence,
  normalizeTopology
} from './sequence-utils.js';

export function normalizeFragment(fragment, index) {
  const orientation = normalizeOrientation(fragment?.orientation);
  const baseSequence = normalizeSequence(fragment?.sequence || '');
  const sequence = orientation === 'reverse'
    ? reverseComplementDna(baseSequence)
    : baseSequence;
  const rawTemplateSequence = normalizeSequence(
    fragment?.templateSequence
    || fragment?.metadata?.templateSequence
    || fragment?.metadata?.sourceTemplateSequence
    || ''
  );
  const templateSequence = rawTemplateSequence && orientation === 'reverse'
    ? reverseComplementDna(rawTemplateSequence)
    : rawTemplateSequence;
  const type = String(fragment?.type || '').trim().toLowerCase() || 'insert';
  const metadata = fragment?.metadata && typeof fragment.metadata === 'object'
    ? { ...fragment.metadata }
    : {};
  if (templateSequence) {
    metadata.templateSequence = templateSequence;
  }

  return {
    id: String(fragment?.id || buildStableFragmentId('fragment', index)),
    name: String(fragment?.name || fragment?.id || buildStableFragmentId('fragment', index)).trim() || buildStableFragmentId('fragment', index),
    type,
    orientation,
    metadata,
    sequence
  };
}

export function normalizeHostVector(host, index) {
  return {
    id: String(host?.id || buildStableFragmentId('host', index)),
    name: String(host?.name || host?.id || buildStableFragmentId('host', index)).trim() || buildStableFragmentId('host', index),
    topology: normalizeTopology(host?.topology || DEFAULT_CLONING_PREFERENCES.topology),
    sequence: normalizeSequence(host?.sequence || '')
  };
}
