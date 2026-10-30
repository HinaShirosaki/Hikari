const PLACEHOLDER_TOKEN_REGEX = /\{\{ph:([^}]+)\}\}/g;

const PAGE_MARGIN = 72;
const TITLE_FONT_SIZE = 20;
const HEADING_FONT_SIZE = 15;
const BODY_FONT_SIZE = 11;
const LINE_HEIGHT = 14;
const TABLE_FONT_SIZE = 8.5;
const TABLE_LINE_HEIGHT = 10.5;
const TABLE_CELL_PADDING = 5;

const ACCENT = [24, 95, 165];
const ACCENT_TINT = [230, 241, 251];
const ZEBRA_FILL = [247, 247, 245];
const MUTED_TEXT = [110, 110, 105];
const RULE_COLOR = [205, 205, 200];
const FOOTER_BASELINE = 40;
const LABEL_FONT_SIZE = 7.5;

// The protocol/notebook document style uses neutral ink so page structure
// survives grayscale and black-and-white printing without large filled areas.
const EDITORIAL_INK = [27, 27, 27];
const EDITORIAL_MUTED = [83, 83, 83];
const EDITORIAL_RULE = [174, 174, 174];

const PLATE_DEFINITIONS = {
  '6': { rows: 2, columns: 3, label: '6 well' },
  '12': { rows: 3, columns: 4, label: '12 well' },
  '24': { rows: 4, columns: 6, label: '24 well' },
  '48': { rows: 6, columns: 8, label: '48 well' },
  '96': { rows: 8, columns: 12, label: '96 well' },
  '384': { rows: 16, columns: 24, label: '384 well' },
  '1536': { rows: 32, columns: 48, label: '1536 well' }
};

export {
  PLACEHOLDER_TOKEN_REGEX,
  PAGE_MARGIN,
  TITLE_FONT_SIZE,
  HEADING_FONT_SIZE,
  BODY_FONT_SIZE,
  LINE_HEIGHT,
  TABLE_FONT_SIZE,
  TABLE_LINE_HEIGHT,
  TABLE_CELL_PADDING,
  ACCENT,
  ACCENT_TINT,
  ZEBRA_FILL,
  MUTED_TEXT,
  RULE_COLOR,
  FOOTER_BASELINE,
  LABEL_FONT_SIZE,
  EDITORIAL_INK,
  EDITORIAL_MUTED,
  EDITORIAL_RULE,
  PLATE_DEFINITIONS
};
