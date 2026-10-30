import { escapeCsv } from '../../lib/csv.js';
import { asArray } from '../../lib/normalize.js';
import { cleanText, normalizeSequenceText } from './shared.js';

// Vendor order formats for designed primers.
//
// IDT's tube Bulk Input takes a paste of tab-separated rows with no header, so
// the fastest path from a finished design to an order is the clipboard, not a
// file: https://www.idtdna.com/site/order/oligoentry
// Sigma, Thermo and Eurofins all want the same four fields in their own Excel
// templates, which is what the CSV block is for -- paste it into their sheet.

export const IDT_BULK_INPUT_URL = 'https://www.idtdna.com/site/order/oligoentry';

export const PRIMER_ORDER_SCALES = Object.freeze([
  { value: '25nm', label: '25 nmole' },
  { value: '100nm', label: '100 nmole' },
  { value: '250nm', label: '250 nmole' },
  { value: '1um', label: '1 umole' },
  { value: '5um', label: '5 umole' },
  { value: '10um', label: '10 umole' }
]);

export const PRIMER_ORDER_PURIFICATIONS = Object.freeze([
  { value: 'STD', label: 'Standard desalting' },
  { value: 'PAGE', label: 'PAGE' },
  { value: 'HPLC', label: 'HPLC' },
  { value: 'IE HPLC', label: 'IE HPLC' }
]);

export const DEFAULT_PRIMER_ORDER_SCALE = '25nm';
export const DEFAULT_PRIMER_ORDER_PURIFICATION = 'STD';

// Standard synthesis runs to 100 bases; past 60 the quality option is Ultramer,
// which is a different order page, so a long oligo is worth flagging rather than
// quietly sending at the default scale.
const ULTRAMER_ADVISORY_LENGTH = 60;
const STANDARD_SYNTHESIS_MAX_LENGTH = 100;

function orderRows(primers) {
  return asArray(primers)
    .map((primer, index) => ({
      name: cleanText(primer?.name, 160) || `primer_${index + 1}`,
      sequence: normalizeSequenceText(primer?.primerSequence || primer?.sequence || '')
    }))
    .filter((row) => row.sequence.length);
}

export function buildPrimerOrderRows(primers, options = {}) {
  const scale = cleanText(options?.scale, 20) || DEFAULT_PRIMER_ORDER_SCALE;
  const purification = cleanText(options?.purification, 20) || DEFAULT_PRIMER_ORDER_PURIFICATION;
  return orderRows(primers).map((row) => ({ ...row, scale, purification }));
}

// Tab-separated, no header row -- that is what IDT's Bulk Input parses.
export function buildIdtBulkInput(primers, options = {}) {
  return buildPrimerOrderRows(primers, options)
    .map((row) => [row.name, row.sequence, row.scale, row.purification].join('\t'))
    .join('\n');
}

// Header row included: this one is pasted into a vendor's own spreadsheet.
export function buildPrimerOrderCsv(primers, options = {}) {
  const rows = buildPrimerOrderRows(primers, options);
  return [
    ['Name', 'Sequence', 'Scale', 'Purification'].join(','),
    ...rows.map((row) => [row.name, row.sequence, row.scale, row.purification].map(escapeCsv).join(','))
  ].join('\n');
}

export function buildPrimerOrderWarnings(primers, options = {}) {
  const rows = buildPrimerOrderRows(primers, options);
  const warnings = [];
  const long = rows.filter((row) => row.sequence.length > ULTRAMER_ADVISORY_LENGTH);
  const tooLong = rows.filter((row) => row.sequence.length > STANDARD_SYNTHESIS_MAX_LENGTH);

  if (tooLong.length) {
    warnings.push(`${tooLong.map((row) => row.name).join(', ')} exceed ${STANDARD_SYNTHESIS_MAX_LENGTH} bases and cannot be ordered as standard oligos; use a long-oligo product such as IDT Ultramer.`);
  } else if (long.length) {
    warnings.push(`${long.map((row) => row.name).join(', ')} are over ${ULTRAMER_ADVISORY_LENGTH} bases; consider a higher synthesis scale with PAGE purification, or IDT Ultramer.`);
  }

  // Eurofins caps the oligo name at 25 characters, and a silently truncated name
  // is worse than a warning: two primers can collapse onto the same label.
  const longNames = rows.filter((row) => row.name.length > 25);
  if (longNames.length) {
    warnings.push(`${longNames.length} primer name${longNames.length === 1 ? '' : 's'} exceed 25 characters, which some vendors (Eurofins) truncate.`);
  }

  const duplicates = rows
    .map((row) => row.name)
    .filter((name, index, list) => list.indexOf(name) !== index);
  if (duplicates.length) {
    warnings.push(`Duplicate primer name${duplicates.length === 1 ? '' : 's'}: ${[...new Set(duplicates)].join(', ')}.`);
  }
  return warnings;
}
