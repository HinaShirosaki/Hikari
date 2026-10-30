
const TAU = Math.PI * 2;

// --- circular geometry -------------------------------------------------------
const RADIUS = 250;
const RING_GAP = 14;
const RING_WIDTH = 18;
const LABEL_PAD = 168;
const LABEL_LINE_HEIGHT = 17;
const LABEL_COLUMN_X = RADIUS + 74;
const TICK_COUNT = 8;
const CIRCULAR_VIEWBOX_SIZE = 2 * (RADIUS + LABEL_PAD);
const CIRCULAR_VIEWBOX_MIN = -(RADIUS + LABEL_PAD);
// Below this fraction of the sequence a feature arc collapses to an unclickable
// sliver, so short features are padded out to stay selectable.
const MIN_ARC_FRACTION = 0.0022;
// Primers get their own track outside the feature lanes: an oligo is an
// annotation *about* the construct, not a part of it, so it should never
// compete with a CDS for a lane or for visual weight.
const PRIMER_RING_GAP = 14;
const PRIMER_HEAD_PX = 11;
// A 22 bp primer is well under a degree of arc on a multi-kb plasmid, so the
// glyph is anchored at the true 5' base and given a minimum visual span.
const PRIMER_MIN_SPAN_PX = 26;

// --- linear geometry ---------------------------------------------------------
// A fixed viewBox in both modes keeps pointer->base inversion a pure function of
// the rendered rect, with no need to read layout back off the DOM.
const LINEAR_VIEWBOX_WIDTH = 1200;
const LINEAR_VIEWBOX_HEIGHT = 360;
const LINEAR_TRACK_X0 = 90;
const LINEAR_TRACK_X1 = 1110;
const LINEAR_AXIS_Y = 300;
const LINEAR_TOP_MARGIN = 64;
const LINEAR_BAND_HEIGHT = 20;
const LINEAR_LANE_GAP = 8;
const LINEAR_FIRST_BAND_GAP = 30;
const LINEAR_ON_BAR_CHAR_PX = 6.4;
const LINEAR_ABOVE_BAR_CHAR_PX = 6.8;
const LINEAR_ABOVE_BAR_ROWS = 3;
const LINEAR_ABOVE_BAR_ROW_HEIGHT = 12;
const LINEAR_MIN_SPAN_PX = 3;
const LINEAR_PRIMER_ROW_OFFSET = 15;
const LINEAR_PRIMER_MIN_SPAN_PX = 24;
const LINEAR_PRIMER_HEAD_PX = 9;

// Zoom scales the SVG's layout box; 1 is "fit the pane", so there is nothing
// useful below it. The cap keeps a single gesture from scrolling into a
// thousand-fold blank field.
const MIN_MAP_ZOOM = 1;
const MAX_MAP_ZOOM = 12;

export {
  CIRCULAR_VIEWBOX_MIN,
  CIRCULAR_VIEWBOX_SIZE,
  LABEL_COLUMN_X,
  LABEL_LINE_HEIGHT,
  LABEL_PAD,
  LINEAR_ABOVE_BAR_CHAR_PX,
  LINEAR_ABOVE_BAR_ROWS,
  LINEAR_ABOVE_BAR_ROW_HEIGHT,
  LINEAR_AXIS_Y,
  LINEAR_BAND_HEIGHT,
  LINEAR_FIRST_BAND_GAP,
  LINEAR_LANE_GAP,
  LINEAR_MIN_SPAN_PX,
  LINEAR_ON_BAR_CHAR_PX,
  LINEAR_PRIMER_HEAD_PX,
  LINEAR_PRIMER_MIN_SPAN_PX,
  LINEAR_PRIMER_ROW_OFFSET,
  LINEAR_TOP_MARGIN,
  LINEAR_TRACK_X0,
  LINEAR_TRACK_X1,
  LINEAR_VIEWBOX_HEIGHT,
  LINEAR_VIEWBOX_WIDTH,
  MAX_MAP_ZOOM,
  MIN_ARC_FRACTION,
  MIN_MAP_ZOOM,
  PRIMER_HEAD_PX,
  PRIMER_MIN_SPAN_PX,
  PRIMER_RING_GAP,
  RADIUS,
  RING_GAP,
  RING_WIDTH,
  TAU,
  TICK_COUNT
};
