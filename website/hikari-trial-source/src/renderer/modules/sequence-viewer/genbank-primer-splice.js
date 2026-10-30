import { asArray } from '../../lib/normalize.js';
import { isPrimerBindingFeature } from './feature-types.js';
import { cleanText } from './shared.js';
import { buildGenbankFeatureLines } from './storage.js';

// Annotating a plasmid the user already has must not rewrite its file. Parsing
// a GenBank record and re-serialising it drops every qualifier and header field
// the viewer does not model (/parts, ACCESSION, the original LOCUS date), so the
// primer sites are spliced into the FEATURES block of the original text instead
// and every other byte is left exactly as it was.

const FEATURES_HEADER = 'FEATURES             Location/Qualifiers';
// A feature block starts in column 6; its qualifiers are indented further.
const FEATURE_BLOCK_START = /^ {5}\S/;
const FEATURE_TYPE = /^ {5}(\S+)/;
const LABEL_QUALIFIER_START = '/label="';
// Where the FEATURES block ends. CONTIG and BASE COUNT are the other two things
// GenBank allows between the features and the sequence.
const AFTER_FEATURES = /^(?:ORIGIN|CONTIG|BASE COUNT)\b/;

function splitFeatureBlocks(lines) {
  const blocks = [];
  lines.forEach((line) => {
    if (FEATURE_BLOCK_START.test(line) || !blocks.length) {
      blocks.push([line]);
      return;
    }
    blocks[blocks.length - 1].push(line);
  });
  return blocks;
}

function blockIsPrimerNamed(block, names) {
  const type = cleanText(block[0].match(FEATURE_TYPE)?.[1], 40);
  if (!isPrimerBindingFeature(type)) {
    return false;
  }
  const label = readQuotedQualifier(block, LABEL_QUALIFIER_START);
  return names.has(cleanText(label, 160).toLowerCase());
}

function readQuotedQualifier(block, marker) {
  const startIndex = block.findIndex((line) => line.includes(marker));
  if (startIndex < 0) {
    return '';
  }

  let value = '';
  for (let index = startIndex; index < block.length; index += 1) {
    const line = String(block[index] || '');
    const chunk = index === startIndex
      ? line.slice(line.indexOf(marker) + marker.length)
      : line.trimStart();
    const closingQuote = chunk.indexOf('"');
    if (closingQuote >= 0) {
      return `${value}${chunk.slice(0, closingQuote)}`;
    }
    value += chunk;
    // The writer hard-wraps an unbroken token exactly at column 80. A shorter
    // line means it wrapped at a space, which must be restored for comparison.
    if (line.length < 80) {
      value += ' ';
    }
  }
  return '';
}

// Returns the file with the given primer features present, or '' when the text
// is not a GenBank record the splice can work on.
export function withPrimerFeaturesInGenbankText(gbkText, primerFeatures, sequenceLength) {
  const text = String(gbkText || '');
  if (!text.trim()) {
    return '';
  }
  const features = asArray(primerFeatures);
  const newLines = features.flatMap((feature) => buildGenbankFeatureLines(feature, sequenceLength));
  if (!newLines.length) {
    return text;
  }

  const lines = text.split('\n');
  const endIndex = lines.findIndex((line) => AFTER_FEATURES.test(line));
  if (endIndex < 0) {
    return '';
  }
  const headerIndex = lines.findIndex((line) => line.startsWith('FEATURES'));
  // A record with no FEATURES block at all gets one rather than falling back to
  // a full rewrite, which would be the lossy path this module exists to avoid.
  const hasHeader = headerIndex >= 0 && headerIndex < endIndex;
  const startIndex = hasHeader ? headerIndex + 1 : endIndex;

  // Same-named primer sites are replaced, so re-running an annotation updates
  // the file instead of stacking a second copy of every primer.
  const names = new Set(features
    .map((feature) => cleanText(feature?.name, 160).toLowerCase())
    .filter(Boolean));
  const kept = splitFeatureBlocks(lines.slice(startIndex, endIndex))
    .filter((block) => !blockIsPrimerNamed(block, names))
    .flat();

  return [
    ...lines.slice(0, startIndex),
    ...(hasHeader ? [] : [FEATURES_HEADER]),
    ...kept,
    ...newLines,
    ...lines.slice(endIndex)
  ].join('\n');
}
