import { reverseComplementDna } from '../calculations/sequence.js';
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
    // The reverse complement has already been taken, so the sequence now reads
    // forward. Saying 'reverse' here made a second pass -- assembleCloningPlan
    // normalizes, then the route evaluators normalize again -- flip it back,
    // and junctions were then evaluated on the opposite strand from the one
    // primer design used.
    orientation: 'forward',
    metadata,
    sequence
  };
}

export function normalizeHostVector(host, index) {
  return {
    id: String(host?.id || buildStableFragmentId('host', index)),
    name: String(host?.name || host?.id || buildStableFragmentId('host', index)).trim() || buildStableFragmentId('host', index),
    topology: normalizeTopology(host?.topology || DEFAULT_CLONING_PREFERENCES.topology),
    sequence: normalizeSequence(host?.sequence || ''),
    // A linearized backbone is not the DNA in its own PCR tube, so the caller
    // has to be able to name the template its primers must be unique against.
    metadata: host?.metadata && typeof host.metadata === 'object' ? { ...host.metadata } : {}
  };
}
