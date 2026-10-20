'use strict';

const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const path = require('node:path');

// Keep line endings: changing the final newline or CRLF is a file change too.
const lines = source => source.match(/[^\n]*\n|[^\n]+$/g) || [];

// ponytail: the search runs on the main thread in O(lines × edits), so it stops
// after MAX_HALF_EDITS steps and the range is logged as a whole replacement
// (lossless, just larger). Move it off-thread if minimal huge-table diffs matter.
const MAX_HALF_EDITS = 1000;

// Myers' middle split uses linear memory, including for large notebook tables.
function middleSplit(before, after, startBefore, endBefore, startAfter, endAfter) {
  const n = endBefore - startBefore;
  const m = endAfter - startAfter;
  const limit = Math.min(Math.ceil((n + m) / 2), MAX_HALF_EDITS);
  const offset = limit + 1;
  const forward = new Int32Array(2 * limit + 3).fill(-1);
  const reverse = new Int32Array(2 * limit + 3).fill(-1);
  forward[offset + 1] = reverse[offset + 1] = 0;
  const delta = n - m;
  const odd = delta % 2 !== 0;
  for (let distance = 0; distance <= limit; distance++) {
    for (let k = -distance; k <= distance; k += 2) {
      const index = offset + k;
      let x = k === -distance || (k !== distance && forward[index - 1] < forward[index + 1])
        ? forward[index + 1] : forward[index - 1] + 1;
      let y = x - k;
      while (x < n && y < m && before[startBefore + x] === after[startAfter + y]) { x++; y++; }
      forward[index] = x;
      const other = offset + delta - k;
      if (odd && other >= 0 && other < reverse.length && reverse[other] >= 0 && x >= n - reverse[other]) return [x, y];
    }
    for (let k = -distance; k <= distance; k += 2) {
      const index = offset + k;
      let x = k === -distance || (k !== distance && reverse[index - 1] < reverse[index + 1])
        ? reverse[index + 1] : reverse[index - 1] + 1;
      let y = x - k;
      while (x < n && y < m && before[endBefore - x - 1] === after[endAfter - y - 1]) { x++; y++; }
      reverse[index] = x;
      const other = offset + delta - k;
      if (!odd && other >= 0 && other < forward.length && forward[other] >= 0 && forward[other] >= n - x) {
        return [forward[other], forward[other] - delta + k];
      }
    }
  }
  return null;
}

function diffLines(before, after, startBefore, endBefore, startAfter, endAfter, emit) {
  while (startBefore < endBefore && startAfter < endAfter && before[startBefore] === after[startAfter]) {
    emit('equal'); startBefore++; startAfter++;
  }
  let suffix = 0;
  while (startBefore < endBefore && startAfter < endAfter && before[endBefore - 1] === after[endAfter - 1]) {
    endBefore--; endAfter--; suffix++;
  }
  if (startBefore === endBefore) {
    for (let index = startAfter; index < endAfter; index++) emit('insert');
  } else if (startAfter === endAfter) {
    for (let index = startBefore; index < endBefore; index++) emit('delete');
  } else {
    // Whole new documents/sections often share no lines. Skip the quadratic
    // search in that case, while still retaining every before/after byte.
    const candidates = new Set(before.slice(startBefore, endBefore));
    let shared = false;
    for (let index = startAfter; index < endAfter && !shared; index++) shared = candidates.has(after[index]);
    const split = shared && middleSplit(before, after, startBefore, endBefore, startAfter, endAfter);
    if (!split) {
      for (let index = startBefore; index < endBefore; index++) emit('delete');
      for (let index = startAfter; index < endAfter; index++) emit('insert');
    } else {
      const [x, y] = split;
      diffLines(before, after, startBefore, startBefore + x, startAfter, startAfter + y, emit);
      diffLines(before, after, startBefore + x, endBefore, startAfter + y, endAfter, emit);
    }
  }
  for (let index = 0; index < suffix; index++) emit('equal');
}

// Coordinates refer to the old and new file respectively, starting at 1.
// null distinguishes a missing line from an existing blank line. Pair adjacent
// removals/additions as replacements; unchanged shifted lines are never edits.
function describeNotebookMarkdownChanges(previous, next) {
  if (previous === next) return [];
  const before = lines(previous);
  const after = lines(next);
  const changes = [];
  let beforeIndex = 0;
  let afterIndex = 0;
  let removed = [];
  let added = [];
  const flush = () => {
    for (let index = 0; index < Math.max(removed.length, added.length); index++) {
      changes.push({
        beforeLine: removed[index]?.line ?? null,
        afterLine: added[index]?.line ?? null,
        before: removed[index]?.text ?? null,
        after: added[index]?.text ?? null
      });
    }
    removed = []; added = [];
  };
  diffLines(before, after, 0, before.length, 0, after.length, operation => {
    if (operation === 'equal') { flush(); beforeIndex++; afterIndex++; }
    else if (operation === 'delete') removed.push({ line: beforeIndex + 1, text: before[beforeIndex++] });
    else added.push({ line: afterIndex + 1, text: after[afterIndex++] });
  });
  flush();
  return changes;
}

// The Markdown writer owns the save queue and calls this only after committing.
// Keep existing JSONL history and append only actual file changes going forward.
async function appendNotebookMarkdownLog(markdownPath, previous, next, warnings = []) {
  if (path.basename(markdownPath) !== 'page.md' || previous === next) return;
  try {
    const changes = describeNotebookMarkdownChanges(previous, next);
    const record = { ts: new Date().toISOString(), file: 'page.md', changes };
    const logPath = path.join(path.dirname(markdownPath), 'page.log');
    await fs.appendFile(logPath, `${JSON.stringify(record)}\n`, { flag: constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | (constants.O_NOFOLLOW || 0) });
  } catch (error) {
    // A log failure must not turn an already committed page into a failed save.
    const warning = `Notebook page.log could not be written for ${markdownPath}: ${error.message}`;
    warnings.push(warning);
    console.warn(warning);
  }
}

module.exports = { appendNotebookMarkdownLog, describeNotebookMarkdownChanges };
