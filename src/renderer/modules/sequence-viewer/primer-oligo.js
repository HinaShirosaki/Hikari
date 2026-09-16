// Base-by-base primer drawing for the sequence lines: the oligo's own bases
// sit inside the primer outline, and every base that does not pair with the
// template -- a 5' tail or an internal mismatch -- is drawn in a bulge that
// steps out of the duplex, the way a mutagenic primer is normally shown.
//
// Set OLIGO_PRIMER_STYLE to 0 to get the original thin dashed oligo line
// back; 1 turns the base-by-base drawing on. Nothing else in the viewer reads
// this flag, so flipping it is the whole switch.
import { escapeHtml } from '../../lib/html.js';
import { primerFeatureSequence } from './primer-hover.js';
import { reverseComplementIupac } from './shared.js';

export const OLIGO_PRIMER_STYLE = 0;

const ROW_HEIGHT_PX = 15;
const LABEL_HEIGHT_PX = 12;
const ARROW_PX = 6;
// Rough width of one label character at the 10px app font, used only to keep a
// label from running off the end of the line.
const LABEL_CHAR_PX = 6;

// One lane holds the label, the annealed band, and the bulge stacked above it.
export const OLIGO_PRIMER_BAR_HEIGHT_PX = LABEL_HEIGHT_PX + (ROW_HEIGHT_PX * 2);

function normalizeOligo(value) {
  return String(value || '').toUpperCase().replace(/U/g, 'T').replace(/[^A-Z]/g, '');
}

// Maps every base of the oligo onto the template column it sits above, left to
// right, and says whether it pairs with the strand it anneals to. A reverse
// primer reads along the bottom strand, so it is shown reversed and its 5' tail
// hangs off the right end instead of the left.
export function buildPrimerColumns({ feature, segment, direction, templateSequence }) {
  const segmentStart = Number(segment?.start);
  const segmentEnd = Number(segment?.end);
  if (!Number.isFinite(segmentStart) || !Number.isFinite(segmentEnd) || segmentEnd <= segmentStart) {
    return null;
  }

  const template = String(templateSequence || '').toUpperCase();
  const bindingLength = segmentEnd - segmentStart;
  // A designed primer carries its oligo; an imported primer_bind (GenBank has
  // nowhere to put one) only has its footprint, so the oligo is read back off
  // the record -- reverse-complemented on the minus strand. Slicing the
  // template directly here would draw the template, not the primer.
  const drawn = normalizeOligo(primerFeatureSequence(feature, template));
  if (drawn.length < bindingLength) {
    return null;
  }

  const tailLength = drawn.length - bindingLength;
  const isReverse = direction === -1;
  const shown = isReverse ? [...drawn].reverse().join('') : drawn;
  const startColumn = isReverse ? segmentStart : segmentStart - tailLength;

  // Only the located binding site anneals. A 5' tail sits outside it and stays
  // unannealed even where a base happens to pair, which is what we draw.
  const bindingFrom = isReverse ? 0 : tailLength;
  const bindingTo = bindingFrom + bindingLength;

  return [...shown].map((base, offset) => {
    const column = startColumn + offset;
    const templateBase = template[column] || '';
    const strandBase = isReverse ? reverseComplementIupac(templateBase) : templateBase;
    const withinBinding = offset >= bindingFrom && offset < bindingTo;
    return { column, base, annealed: withinBinding && Boolean(strandBase) && base === strandBase };
  });
}

// Widens the fragment to cover the tail as well, so lane packing still keeps
// primers from overlapping once the extra bases are drawn.
export function withOligoPrimerGeometry(fragment, {
  segment,
  lineStart,
  lineEnd,
  templateSequence,
  charAdvancePx
} = {}) {
  if (!OLIGO_PRIMER_STYLE || !fragment?.isPrimer) {
    return fragment;
  }
  // ponytail: an origin-wrapped primer keeps the original thin-line drawing --
  // each of its two fragments would need the other's share of the oligo to know
  // which base belongs in which column. Widen this if wrapped primers matter.
  const segments = Array.isArray(fragment.feature?.segments) ? fragment.feature.segments : [];
  if (segments.length !== 1) {
    return fragment;
  }

  const columns = buildPrimerColumns({
    feature: fragment.feature,
    segment,
    direction: fragment.direction,
    templateSequence
  });
  if (!columns) {
    return fragment;
  }

  const visible = columns.filter((entry) => entry.column >= lineStart && entry.column < lineEnd);
  if (!visible.length) {
    return fragment;
  }

  const startColumn = visible[0].column;
  const endColumn = visible[visible.length - 1].column + 1;
  const leftPx = Math.max(0, (startColumn - lineStart) * charAdvancePx);
  const widthPx = Math.max(charAdvancePx, (endColumn - startColumn) * charAdvancePx);
  const clippedLeft = visible[0].column > columns[0].column;
  const clippedRight = visible[visible.length - 1].column < columns[columns.length - 1].column;

  return {
    ...fragment,
    leftPx,
    widthPx,
    rightPx: leftPx + widthPx,
    oligo: {
      columns: visible,
      startColumn,
      charAdvancePx,
      // The arrowhead marks the 3' end, which is only on this fragment when the
      // oligo is not cut off there by the line wrap.
      hasThreePrime: fragment.direction === -1 ? !clippedLeft : !clippedRight
    }
  };
}

function groupRuns(columns) {
  const runs = [];
  columns.forEach((entry, index) => {
    const previous = runs[runs.length - 1];
    if (previous && previous.annealed === entry.annealed && previous.endOffset === index) {
      previous.endOffset = index + 1;
      previous.bases.push(entry);
      return;
    }
    runs.push({ annealed: entry.annealed, startOffset: index, endOffset: index + 1, bases: [entry] });
  });
  return runs;
}

// Outline of the whole oligo as one polygon: the band rides at strand level over
// annealed runs and steps a full row out of the duplex over unannealed ones.
function buildOutlinePoints(runs, { advance, height, isReverse, hasThreePrime }) {
  const bandTop = (annealed) => (isReverse
    ? ROW_HEIGHT_PX * (annealed ? 0 : 1)
    : height - (ROW_HEIGHT_PX * (annealed ? 1 : 2)));
  const bandBottom = (annealed) => bandTop(annealed) + ROW_HEIGHT_PX;
  const xAt = (offset) => offset * advance;

  const top = [];
  const bottom = [];
  runs.forEach((run) => {
    const x0 = xAt(run.startOffset);
    const x1 = xAt(run.endOffset);
    top.push([x0, bandTop(run.annealed)], [x1, bandTop(run.annealed)]);
    bottom.push([x0, bandBottom(run.annealed)], [x1, bandBottom(run.annealed)]);
  });
  // Walked back right-to-left so the polygon closes instead of crossing itself.
  bottom.reverse();

  const points = [...top];
  const last = runs[runs.length - 1];
  const first = runs[0];
  if (hasThreePrime && !isReverse) {
    points.push([xAt(last.endOffset) + ARROW_PX, (bandTop(last.annealed) + bandBottom(last.annealed)) / 2]);
  }
  points.push(...bottom);
  if (hasThreePrime && isReverse) {
    points.push([xAt(first.startOffset) - ARROW_PX, (bandTop(first.annealed) + bandBottom(first.annealed)) / 2]);
  }
  return points.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
}

function buildBaseTextSvg(runs, { advance, height, isReverse }) {
  const bandTop = (annealed) => (isReverse
    ? ROW_HEIGHT_PX * (annealed ? 0 : 1)
    : height - (ROW_HEIGHT_PX * (annealed ? 1 : 2)));
  return runs
    .map((run) => run.bases
      .map((entry, offsetInRun) => {
        const offset = run.startOffset + offsetInRun;
        const x = (offset + 0.5) * advance;
        const y = bandTop(run.annealed) + (ROW_HEIGHT_PX * 0.76);
        const className = run.annealed
          ? 'sequence-viewer-primer-nt'
          : 'sequence-viewer-primer-nt sequence-viewer-primer-nt-unannealed';
        return `<text class="${className}" x="${x.toFixed(2)}" y="${y.toFixed(2)}" text-anchor="middle">${escapeHtml(entry.base)}</text>`;
      })
      .join(''))
    .join('');
}

// The name rides the 3' end, on whichever fragment carries it. It sits in its
// own row clear of the outline, so it is free to overflow the primer's width --
// a 24 nt primer is narrower than most designed names, and gating on width was
// dropping the name entirely. It only changes ends to stay inside the line.
function buildLabelSvg(fragment, { label, height, isReverse, hasThreePrime, lineWidthPx }) {
  const text = String(label || '');
  if (!text || !hasThreePrime) {
    return '';
  }
  const labelWidthPx = text.length * LABEL_CHAR_PX;
  const anchorAtThreePrimeEnd = isReverse
    // Reverse names run rightwards from the 3' (left) end, so they flip when
    // that would take them past the end of the line.
    ? !(lineWidthPx > 0 && (fragment.leftPx + labelWidthPx) > lineWidthPx)
    // Forward names run leftwards from the 3' (right) end.
    : (fragment.leftPx + fragment.widthPx - labelWidthPx) >= 0;
  const atLeftEdge = isReverse ? anchorAtThreePrimeEnd : !anchorAtThreePrimeEnd;
  const x = atLeftEdge ? 0 : fragment.widthPx;
  const y = isReverse ? height - 3 : LABEL_HEIGHT_PX - 3;
  return `<text class="sequence-viewer-primer-svg-label" x="${x.toFixed(2)}" y="${y.toFixed(2)}" text-anchor="${atLeftEdge ? 'start' : 'end'}">${escapeHtml(text)}</text>`;
}

export function buildOligoPrimerHtml(fragment, { topPx, isActive, label, lineWidthPx = 0 } = {}) {
  const oligo = fragment?.oligo;
  if (!oligo) {
    return '';
  }

  const advance = oligo.charAdvancePx;
  const isReverse = fragment.direction === -1;
  const runs = groupRuns(oligo.columns);
  const height = OLIGO_PRIMER_BAR_HEIGHT_PX;
  const points = buildOutlinePoints(runs, {
    advance, height, isReverse, hasThreePrime: oligo.hasThreePrime
  });
  const bases = buildBaseTextSvg(runs, { advance, height, isReverse });
  const labelSvg = buildLabelSvg(fragment, {
    label, height, isReverse, hasThreePrime: oligo.hasThreePrime, lineWidthPx
  });
  const directionClass = isReverse
    ? 'sequence-viewer-line-feature-primer-reverse'
    : 'sequence-viewer-line-feature-primer-forward';

  return `
    <button
      type="button"
      class="sequence-viewer-line-feature sequence-viewer-line-feature-primer sequence-viewer-line-feature-primer-oligo ${directionClass}${isActive ? ' sequence-viewer-line-feature-active' : ''}"
      data-feature-index="${fragment.index}"
      style="left:${fragment.leftPx.toFixed(3)}px;width:${fragment.widthPx.toFixed(3)}px;height:${height}px;top:${Number(topPx || 0).toFixed(3)}px;--sequence-viewer-primer-color:${fragment.color};color:${fragment.color};"
      title="${escapeHtml(fragment.title)}"
      aria-label="${escapeHtml(fragment.title)}"
    >
      <svg
        class="sequence-viewer-primer-svg"
        viewBox="${-ARROW_PX} 0 ${(fragment.widthPx + (ARROW_PX * 2)).toFixed(2)} ${height}"
        style="left:${-ARROW_PX}px;width:${(fragment.widthPx + (ARROW_PX * 2)).toFixed(3)}px;height:${height}px;"
        aria-hidden="true"
      >
        <polygon class="sequence-viewer-primer-outline" points="${points}"></polygon>
        ${bases}
        ${labelSvg}
      </svg>
    </button>
  `;
}
