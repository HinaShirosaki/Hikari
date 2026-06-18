import { oligoTm } from '../oligo.js';
import {
  DEFAULT_CLONING_PREFERENCES,
  DEFAULT_MAX_ENGINEERED_OVERLAP_LENGTH,
  DEFAULT_MIN_ENGINEERED_OVERLAP_LENGTH
} from './constants.js';
import { normalizeSequence } from './sequence-utils.js';
import { longestTerminalOverlap } from './overlap-windows.js';
import { buildPrimerRecord } from './primer-records.js';
import { findMutagenesisWindow } from './mutagenesis-simple.js';

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
  const template = normalizeSequence(templateSequence);
  const insertedSequence = normalizeSequence(normalizedEdit.editedSequence || '');
  const leftFlank = template.slice(0, normalizedEdit.startIndex);
  const rightFlank = template.slice(normalizedEdit.endIndex);
  if (!insertedSequence.length) {
    return {
      feasible: false,
      warnings: ['Multi-primer tiling only applies to edits that insert DNA.']
    };
  }

  const maxPrimerLength = Math.max(0, Number(config?.maxPrimerLength) || DEFAULT_CLONING_PREFERENCES.maxPrimerLength);
  const leftAnchor = findMutagenesisWindow(leftFlank, 'left', thresholds, Math.min(maxPrimerLength, Number(thresholds?.primerLength?.max) || maxPrimerLength));
  const rightAnchor = findMutagenesisWindow(rightFlank, 'right', thresholds, Math.min(maxPrimerLength, Number(thresholds?.primerLength?.max) || maxPrimerLength));
  if (!leftAnchor || !rightAnchor) {
    return {
      feasible: false,
      warnings: ['Failed to locate left/right anchor windows for tiled insertion design.']
    };
  }

  const maxWindowLength = Math.max(
    Number(thresholds?.primerLength?.max) || 0,
    maxPrimerLength - Math.max(leftAnchor.length, rightAnchor.length)
  );

  for (let overlapLength = Number(config?.minEngineeredOverlapLength) || DEFAULT_MIN_ENGINEERED_OVERLAP_LENGTH;
    overlapLength <= Math.min(insertedSequence.length - 1, Number(config?.maxEngineeredOverlapLength) || DEFAULT_MAX_ENGINEERED_OVERLAP_LENGTH);
    overlapLength += 1) {
    const windows = buildOverlappingWindows(insertedSequence, maxWindowLength, overlapLength);
    if (windows.length < 2) {
      continue;
    }

    const overlapSummary = [];
    let overlapsValid = true;
    for (let index = 0; index < windows.length - 1; index += 1) {
      const left = windows[index].sequence;
      const right = windows[index + 1].sequence;
      const overlap = longestTerminalOverlap(left, right, overlapLength);
      const overlapTm = oligoTm(overlap.sequence, 'DNA');
      if (
        overlap.length !== overlapLength
        || overlapTm < thresholds.overlapTm.min
        || overlapTm > thresholds.overlapTm.max
      ) {
        overlapsValid = false;
        break;
      }
      overlapSummary.push({
        leftFragmentId: index === 0 ? 'tile_outer_left' : `tile_${index}`,
        rightFragmentId: index === windows.length - 2 ? 'tile_outer_right' : `tile_${index + 1}`,
        overlapSequence: overlap.sequence,
        overlapLength: overlap.length,
        overlapTm,
        mode: 'tiled-insert'
      });
    }

    if (!overlapsValid) {
      continue;
    }

    const firstSequence = `${leftAnchor.sequence}${windows[0].sequence}`;
    const lastSequence = `${windows[windows.length - 1].sequence}${rightAnchor.sequence}`;
    if (firstSequence.length > maxPrimerLength || lastSequence.length > maxPrimerLength) {
      continue;
    }

    const primers = [
      buildPrimerRecord({
        name: 'tile_outer_left',
        role: 'mutagenesis-outer-left',
        sequence: firstSequence,
        tailSequence: windows[0].sequence,
        bindingSequence: leftAnchor.sequence,
        warnings: []
      }),
      ...windows.slice(1, -1).map((window, index) => buildPrimerRecord({
        name: `tile_${index + 1}`,
        role: 'insert-tile',
        sequence: window.sequence,
        tailSequence: window.sequence.slice(0, overlapLength),
        bindingSequence: window.sequence.slice(overlapLength),
        warnings: []
      })),
      buildPrimerRecord({
        name: 'tile_outer_right',
        role: 'mutagenesis-outer-right',
        sequence: lastSequence,
        tailSequence: windows[windows.length - 1].sequence.slice(-overlapLength),
        bindingSequence: rightAnchor.sequence,
        warnings: []
      })
    ];

    return {
      feasible: true,
      primers,
      overlapSummary,
      warnings: ['Long insertion uses multi-primer tiling rather than a single primer pair.']
    };
  }

  return {
    feasible: false,
    warnings: ['Unable to find a tiled insertion design that satisfies the current overlap and primer thresholds.']
  };
}
