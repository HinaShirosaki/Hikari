import { normalizeSequence } from './sequence-utils.js';

export function buildOverlappingWindows(sequence, maxWindowLength, overlapLength) {
  const cleaned = normalizeSequence(sequence);
  if (!cleaned.length || maxWindowLength <= 0) {
    return [];
  }

  const windows = [];
  let start = 0;
  while (start < cleaned.length) {
    const end = Math.min(cleaned.length, start + maxWindowLength);
    windows.push({
      start,
      end,
      sequence: cleaned.slice(start, end)
    });
    if (end >= cleaned.length) {
      break;
    }
    const nextStart = end - overlapLength;
    if (nextStart <= start) {
      return [];
    }
    start = nextStart;
  }
  return windows;
}

export function designTiledInsertionOligos(templateSequence, normalizedEdit, thresholds, config) {
  const insertedSequence = normalizeSequence(normalizedEdit.editedSequence || '');
  if (!insertedSequence.length) {
    return {
      feasible: false,
      warnings: ['Multi-primer tiling only applies to edits that insert DNA.']
    };
  }

  return {
    feasible: false,
    primers: [],
    recommendedRoute: 'q5-kld',
    warnings: [
      `The ${insertedSequence.length}-nt edit does not fit the complementary whole-plasmid primer route. Use Q5/KLD split-tail primers, Gibson/In-Fusion, or a synthesized fragment; same-strand tiled oligos are not emitted.`
    ]
  };
}
