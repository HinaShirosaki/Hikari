import { asArray } from './sequence-utils.js';
import { normalizeHostVector } from './fragments.js';

// Builders supply the chosen backbone. Never infer a different tube by scoring
// sequence similarity against the result or other stock records.
export function findSelectedHostVector(hostVectors, hostVectorId = '') {
  const hosts = asArray(hostVectors).map(normalizeHostVector);
  const requestedId = String(hostVectorId || '').trim();
  const selected = requestedId
    ? hosts.find((host) => host.id === requestedId)
    : hosts.length === 1 ? hosts[0] : null;
  return selected?.sequence.length ? selected : null;
}
