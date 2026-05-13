'use strict';

const LINE_Y_TOLERANCE_FRACTION = 0.5;
const COLUMN_GAP_FONT_MULTIPLE = 2;
const INTRA_WORD_GAP_FONT_FRACTION = 0.2;

function numberOrDefault(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getItemFontSize(item) {
  const height = numberOrDefault(item?.height, 0);
  if (height > 0) {
    return height;
  }
  const transform = Array.isArray(item?.transform) ? item.transform : null;
  const yScale = Math.abs(numberOrDefault(transform?.[3], 0));
  return yScale > 0 ? yScale : 10;
}

function buildVisualLinesFromItems(items) {
  if (!Array.isArray(items) || !items.length) {
    return [];
  }
  const lines = [];
  let current = null;
  const flush = () => {
    if (current && current.items.length) {
      current.items.sort((left, right) => left.x - right.x);
      lines.push(current);
    }
    current = null;
  };

  items.forEach((item) => {
    if (!item) {
      return;
    }
    const str = typeof item.str === 'string' ? item.str : '';
    const transform = Array.isArray(item.transform) ? item.transform : null;
    const hasPosition = !!transform;
    const x = numberOrDefault(transform?.[4], 0);
    const y = numberOrDefault(transform?.[5], 0);
    const width = numberOrDefault(item.width, 0);
    const height = getItemFontSize(item);

    if (str) {
      if (current && hasPosition) {
        const refHeight = current.items[0]?.height || height || 10;
        if (Math.abs(y - current.y) > refHeight * LINE_Y_TOLERANCE_FRACTION) {
          flush();
        }
      }
      if (!current) {
        current = { y, items: [] };
      }
      current.items.push({ x, y, width, height, str, hasPosition });
    }

    if (item.hasEOL) {
      flush();
    }
  });
  flush();
  return lines;
}

function joinLineItemsToText(lineItems) {
  let text = '';
  let prev = null;
  for (const item of lineItems) {
    if (prev) {
      let needsSpace;
      if (item.hasPosition && prev.hasPosition) {
        const gap = item.x - (prev.x + prev.width);
        const fontSize = item.height || prev.height || 10;
        needsSpace = gap > fontSize * INTRA_WORD_GAP_FONT_FRACTION;
      } else {
        needsSpace = true;
      }
      if (needsSpace && !text.endsWith(' ') && !item.str.startsWith(' ')) {
        text += ' ';
      }
    }
    text += item.str;
    prev = item;
  }
  return text.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function splitLineIntoCells(lineItems) {
  if (!lineItems.length) {
    return [];
  }
  if (lineItems.some((item) => !item.hasPosition)) {
    return [lineItems];
  }
  const cells = [];
  let current = [lineItems[0]];
  for (let i = 1; i < lineItems.length; i += 1) {
    const prev = lineItems[i - 1];
    const curr = lineItems[i];
    const gap = curr.x - (prev.x + prev.width);
    const fontSize = curr.height || prev.height || 10;
    if (gap > fontSize * COLUMN_GAP_FONT_MULTIPLE) {
      cells.push(current);
      current = [curr];
    } else {
      current.push(curr);
    }
  }
  cells.push(current);
  return cells;
}

function cellsToText(cells) {
  return cells.map((cellItems) => joinLineItemsToText(cellItems));
}

function isTableCaptionText(text) {
  return /^(?:extended\s+data\s+)?table\s*\d+/i.test(String(text || '').trim());
}

function isMarkdownTableLine(line) {
  return /^\s*\|.*\|\s*$/.test(String(line || ''));
}

function escapeMarkdownTableCell(text) {
  return String(text || '')
    .replace(/\|/g, '\\|')
    .replace(/[\r\n]+/g, ' ')
    .trim();
}

function emitMarkdownTable(headerCells, rowCellsArray) {
  const numCols = Math.max(
    headerCells.length,
    ...rowCellsArray.map((row) => row.length),
    1
  );
  const pad = (cells) => {
    const arr = cells.slice(0, numCols).map(escapeMarkdownTableCell);
    while (arr.length < numCols) {
      arr.push('');
    }
    return arr;
  };
  const headerRow = `| ${pad(headerCells).join(' | ')} |`;
  const separator = `| ${Array(numCols).fill('---').join(' | ')} |`;
  const dataRows = rowCellsArray.map((cells) => `| ${pad(cells).join(' | ')} |`);
  return [headerRow, separator, ...dataRows].join('\n');
}

const TABLE_MIN_COLUMNS = 3;
const TABLE_HEADER_LOOKAHEAD = 12;
const CONTINUATION_X_TOLERANCE = 30;

function findNearestColumnIndex(x, anchors) {
  let best = 0;
  let bestDist = Math.abs(x - anchors[0]);
  for (let i = 1; i < anchors.length; i += 1) {
    const dist = Math.abs(x - anchors[i]);
    if (dist < bestDist) {
      best = i;
      bestDist = dist;
    }
  }
  return best;
}

function detectTableRegionsForLines(lines, lineTexts) {
  const regions = [];
  let i = 0;
  while (i < lines.length) {
    if (!isTableCaptionText(lineTexts[i])) {
      i += 1;
      continue;
    }
    // Look ahead inside a bounded window and find the longest consecutive
    // run of "wide" lines (cells.length close to the window max). The first
    // line of that run is the first canonical data row; lines between the
    // caption and the run are wrapped header content.
    const windowStart = i + 1;
    const windowEnd = Math.min(lines.length, windowStart + TABLE_HEADER_LOOKAHEAD);
    const cellsPerLine = [];
    for (let j = windowStart; j < windowEnd; j += 1) {
      cellsPerLine.push(splitLineIntoCells(lines[j].items));
    }
    let maxCells = 0;
    for (const cells of cellsPerLine) {
      if (cells.length > maxCells) maxCells = cells.length;
    }
    if (maxCells < TABLE_MIN_COLUMNS) {
      i += 1;
      continue;
    }
    const runThreshold = Math.max(2, maxCells - 1);
    let bestStart = -1;
    let bestLen = 0;
    let curStart = -1;
    let curLen = 0;
    for (let k = 0; k < cellsPerLine.length; k += 1) {
      if (cellsPerLine[k].length >= runThreshold) {
        if (curStart < 0) curStart = k;
        curLen += 1;
        if (curLen > bestLen) {
          bestLen = curLen;
          bestStart = curStart;
        }
      } else {
        curStart = -1;
        curLen = 0;
      }
    }
    if (bestStart < 0) {
      i += 1;
      continue;
    }
    const dataStartIdx = windowStart + bestStart;
    const initialDataEndIdx = dataStartIdx + bestLen - 1;
    const anchors = cellsPerLine[bestStart].map((cellItems) => cellItems[0]?.x ?? 0);
    const lastAnchor = anchors[anchors.length - 1];
    // Extend forward: additional rows or 1-cell continuations of the last column.
    let dataEndIdx = initialDataEndIdx;
    for (let j = initialDataEndIdx + 1; j < lines.length; j += 1) {
      const cells = splitLineIntoCells(lines[j].items);
      if (cells.length >= runThreshold) {
        dataEndIdx = j;
        continue;
      }
      if (cells.length === 1 && cells[0][0] && cells[0][0].x >= lastAnchor - CONTINUATION_X_TOLERANCE) {
        dataEndIdx = j;
        continue;
      }
      break;
    }
    regions.push({
      captionIdx: i,
      headerStartIdx: i + 1,
      dataStartIdx,
      dataEndIdx,
      anchors
    });
    i = dataEndIdx + 1;
  }
  return regions;
}

function buildHeaderCellsFromLines(headerLines, anchors) {
  const bins = anchors.map(() => []);
  for (const line of headerLines) {
    for (const item of line.items) {
      const colIdx = findNearestColumnIndex(item.x, anchors);
      bins[colIdx].push(item.str);
    }
  }
  return bins.map((parts) => {
    // Join header fragments, drop line-wrap hyphens (e.g. "resi-" + " " + "due range" => "residue range")
    const joined = parts.join(' ').replace(/-\s+/g, '').replace(/\s+/g, ' ').trim();
    return joined;
  });
}

function buildDataRowsFromLines(dataLines, anchors) {
  const lastAnchor = anchors[anchors.length - 1];
  const rows = [];
  for (const line of dataLines) {
    const cells = splitLineIntoCells(line.items);
    if (cells.length === 1 && rows.length) {
      const firstItem = cells[0][0];
      if (firstItem && firstItem.x >= lastAnchor - CONTINUATION_X_TOLERANCE) {
        const lastRow = rows[rows.length - 1];
        const continuation = joinLineItemsToText(cells[0]);
        lastRow[lastRow.length - 1] = `${lastRow[lastRow.length - 1]} ${continuation}`.trim();
        continue;
      }
    }
    rows.push(cellsToText(cells));
  }
  return rows;
}

function renderVisualLines(lines) {
  if (!lines.length) {
    return '';
  }
  const lineTexts = lines.map((line) => joinLineItemsToText(line.items));
  const regions = detectTableRegionsForLines(lines, lineTexts);
  if (!regions.length) {
    return lineTexts.filter(Boolean).join('\n');
  }

  const segments = [];
  let cursor = 0;
  for (const region of regions) {
    for (let k = cursor; k <= region.captionIdx; k += 1) {
      if (lineTexts[k]) {
        segments.push(lineTexts[k]);
      }
    }
    segments.push('');

    let headerLines = lines.slice(region.headerStartIdx, region.dataStartIdx);
    let dataLines = lines.slice(region.dataStartIdx, region.dataEndIdx + 1);
    if (headerLines.length === 0 && dataLines.length > 0) {
      // No wrapped header above: the first data-shaped line is the header.
      headerLines = [dataLines[0]];
      dataLines = dataLines.slice(1);
    }
    const headerCells = buildHeaderCellsFromLines(headerLines, region.anchors);
    const dataRows = buildDataRowsFromLines(dataLines, region.anchors);
    segments.push(emitMarkdownTable(headerCells, dataRows));
    segments.push('');
    cursor = region.dataEndIdx + 1;
  }
  for (let k = cursor; k < lines.length; k += 1) {
    if (lineTexts[k]) {
      segments.push(lineTexts[k]);
    }
  }

  return segments
    .filter((segment, idx, arr) => !(segment === '' && (idx === 0 || arr[idx - 1] === '')))
    .join('\n');
}

function joinTextItems(items) {
  const lines = buildVisualLinesFromItems(items);
  return renderVisualLines(lines);
}

const RUNNING_BOILERPLATE_MIN_PAGES = 3;
const RUNNING_BOILERPLATE_LINE_WINDOW = 4;

function normalizeLineForBoilerplate(line) {
  return String(line || '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\d+/g, '#');
}

function collectBoilerplateLineKeys(pages) {
  // Count how many pages have each normalized line in their head or tail
  // window. Combining head + tail in one count handles the case where the
  // same running line falls into the head window on a short page but the
  // tail window on a longer one.
  const edgeCounts = new Map();
  for (const page of pages) {
    const lines = String(page?.text || '').split('\n');
    if (!lines.length) continue;
    const headEnd = Math.min(lines.length, RUNNING_BOILERPLATE_LINE_WINDOW);
    const tailStart = Math.max(headEnd, lines.length - RUNNING_BOILERPLATE_LINE_WINDOW);
    const seenOnPage = new Set();
    const observe = (line) => {
      const key = normalizeLineForBoilerplate(line);
      if (!key || seenOnPage.has(key)) return;
      seenOnPage.add(key);
      edgeCounts.set(key, (edgeCounts.get(key) || 0) + 1);
    };
    for (let i = 0; i < headEnd; i += 1) observe(lines[i]);
    for (let i = tailStart; i < lines.length; i += 1) observe(lines[i]);
  }
  const boilerplate = new Set();
  for (const [key, count] of edgeCounts) {
    if (count >= RUNNING_BOILERPLATE_MIN_PAGES) boilerplate.add(key);
  }
  return boilerplate;
}

function stripRunningHeadersAndFooters(pages) {
  if (!Array.isArray(pages) || pages.length < RUNNING_BOILERPLATE_MIN_PAGES) {
    return pages.slice();
  }
  const boilerplate = collectBoilerplateLineKeys(pages);
  if (!boilerplate.size) {
    return pages.slice();
  }
  return pages.map((page) => {
    const text = String(page?.text || '');
    if (!text) return page;
    const lines = text.split('\n');
    const headEnd = Math.min(lines.length, RUNNING_BOILERPLATE_LINE_WINDOW);
    const tailStart = Math.max(headEnd, lines.length - RUNNING_BOILERPLATE_LINE_WINDOW);
    const filtered = lines.filter((line, idx) => {
      const key = normalizeLineForBoilerplate(line);
      if (!key) return true;
      const inEdge = idx < headEnd || idx >= tailStart;
      return !(inEdge && boilerplate.has(key));
    });
    const cleaned = filtered.join('\n').trim();
    if (cleaned === text.trim()) return page;
    return {
      ...page,
      text: cleaned,
      character_count: cleaned.length
    };
  });
}

module.exports = {
  LINE_Y_TOLERANCE_FRACTION,
  COLUMN_GAP_FONT_MULTIPLE,
  INTRA_WORD_GAP_FONT_FRACTION,
  buildVisualLinesFromItems,
  joinLineItemsToText,
  splitLineIntoCells,
  cellsToText,
  isTableCaptionText,
  isMarkdownTableLine,
  escapeMarkdownTableCell,
  emitMarkdownTable,
  detectTableRegionsForLines,
  renderVisualLines,
  joinTextItems,
  normalizeLineForBoilerplate,
  collectBoilerplateLineKeys,
  stripRunningHeadersAndFooters
};
