'use strict';

const ASSAY_TABLE_ACTIONS = Object.freeze([
  'create',
  'read',
  'list',
  'derive',
  'add_column',
  'python',
  'delete',
  'clear'
]);

const MAX_NAME_LENGTH = 160;
const MAX_SOURCE_LENGTH = 1200;
const MAX_COLUMNS = 200;
const MAX_ROWS = 5000;
const MAX_CELL_LENGTH = 4000;
const MAX_PREVIEW_ROWS = 50;

module.exports = {
  ASSAY_TABLE_ACTIONS,
  MAX_CELL_LENGTH,
  MAX_COLUMNS,
  MAX_NAME_LENGTH,
  MAX_PREVIEW_ROWS,
  MAX_ROWS,
  MAX_SOURCE_LENGTH
};
