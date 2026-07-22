// SnapGene .dna -> GenBank (.gbk) converter.
//
// A .dna file is a flat sequence of segments, each: [1 byte type]
// [4-byte big-endian length][length bytes of data]. We read the ones that
// matter for opening the file in a sequence viewer:
//   type 9  (cookie)   - "SnapGene" magic + versions; used only to validate.
//   type 0  (DNA)      - 1 flags byte (bit 0 = circular) then the ASCII bases.
//   type 10 (features) - XML; parsed best-effort into a GenBank feature table.
//
// Only the sequence and topology are required to open the file; features are a
// bonus, so anything unparseable there is skipped rather than fatal.
//
// Format reference: the reverse-engineered layout used by BioPython's
// SnapGeneIO and teselagen's sequence parsers.

const COOKIE_MAGIC = 'SnapGene';

function readUint32BE(bytes, offset) {
  // Plain arithmetic, not <<24, so the high bit does not make the value negative.
  return (bytes[offset] * 16777216)
    + (bytes[offset + 1] * 65536)
    + (bytes[offset + 2] * 256)
    + bytes[offset + 3];
}

function bytesToLatin1(bytes) {
  // ponytail: naive concat, fine for plasmid-scale sequences (tens of kb);
  // swap for TextDecoder if someone feeds it a chromosome.
  let out = '';
  for (let i = 0; i < bytes.length; i += 1) {
    out += String.fromCharCode(bytes[i]);
  }
  return out;
}

function readSegments(bytes) {
  const segments = [];
  let offset = 0;
  while (offset + 5 <= bytes.length) {
    const type = bytes[offset];
    const length = readUint32BE(bytes, offset + 1);
    offset += 5;
    if (length < 0 || offset + length > bytes.length) {
      break;
    }
    segments.push({ type, data: bytes.subarray(offset, offset + length) });
    offset += length;
  }
  return segments;
}

// Pulls features out of the type-10 XML without a full XML parser. SnapGene
// writes one <Feature name=".." type=".." directionality="..">…<Segment
// range="a-b"/>…</Feature> per feature; we take the first segment's range.
// ponytail: regex over a known, self-emitted shape — it handles the common
// single-range feature, not arbitrary nested SnapGene XML. Unmatched features
// are simply dropped.
function parseFeaturesXml(xml) {
  const features = [];
  const featureRe = /<Feature\b([^>]*)>([\s\S]*?)<\/Feature>/g;
  let match;
  while ((match = featureRe.exec(xml))) {
    const attrs = match[1];
    const body = match[2];
    const name = (/\bname="([^"]*)"/.exec(attrs) || [])[1] || '';
    const type = (/\btype="([^"]*)"/.exec(attrs) || [])[1] || 'misc_feature';
    const directionality = (/\bdirectionality="([^"]*)"/.exec(attrs) || [])[1] || '1';
    const range = (/<Segment\b[^>]*\brange="(\d+)-(\d+)"/.exec(body) || []);
    if (!range.length) {
      continue;
    }
    features.push({
      type,
      name,
      start: Number(range[1]),
      end: Number(range[2]),
      reverse: directionality === '2'
    });
  }
  return features;
}

export function parseSnapGeneDna(bytes) {
  const input = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  const segments = readSegments(input);
  if (!segments.length) {
    throw new Error('Not a SnapGene .dna file (no segments found).');
  }
  const cookie = segments[0];
  if (cookie.type !== 9 || bytesToLatin1(cookie.data.subarray(0, COOKIE_MAGIC.length)) !== COOKIE_MAGIC) {
    throw new Error('Not a SnapGene .dna file (missing SnapGene header).');
  }

  const dna = segments.find((segment) => segment.type === 0);
  if (!dna || dna.data.length < 2) {
    throw new Error('SnapGene file has no DNA sequence block.');
  }
  const circular = (dna.data[0] & 1) === 1;
  const sequence = bytesToLatin1(dna.data.subarray(1)).replace(/[^A-Za-z]/g, '');

  const featureBlock = segments.find((segment) => segment.type === 10);
  const features = featureBlock ? parseFeaturesXml(bytesToLatin1(featureBlock.data)) : [];

  return { sequence, circular, features };
}

function formatOrigin(sequence) {
  const lines = [];
  const lower = sequence.toLowerCase();
  for (let i = 0; i < lower.length; i += 60) {
    const chunk = lower.slice(i, i + 60);
    const groups = chunk.match(/.{1,10}/g) || [];
    lines.push(`${String(i + 1).padStart(9, ' ')} ${groups.join(' ')}`);
  }
  return lines.join('\n');
}

export function toGenBank({ name, sequence, circular, features = [] }) {
  const safeName = (String(name || 'sequence').replace(/[^A-Za-z0-9_.-]/g, '_') || 'sequence').slice(0, 24);
  const topology = circular ? 'circular' : 'linear';
  const header = `LOCUS       ${safeName} ${sequence.length} bp ds-DNA     ${topology}   SYN 01-JAN-2024`;

  const featureLines = ['FEATURES             Location/Qualifiers', `     source          1..${sequence.length}`];
  for (const feature of features) {
    const type = (feature.type || 'misc_feature').replace(/\s+/g, '_').slice(0, 15);
    const location = feature.reverse
      ? `complement(${feature.start}..${feature.end})`
      : `${feature.start}..${feature.end}`;
    featureLines.push(`     ${type.padEnd(15, ' ')} ${location}`);
    if (feature.name) {
      featureLines.push(`                     /label="${feature.name.replace(/"/g, "'")}"`);
    }
  }

  return `${header}\n${featureLines.join('\n')}\nORIGIN\n${formatOrigin(sequence)}\n//\n`;
}

export function convertDnaToGenBank(bytes, { name } = {}) {
  const { sequence, circular, features } = parseSnapGeneDna(bytes);
  if (!sequence) {
    throw new Error('SnapGene file contained an empty sequence.');
  }
  return toGenBank({ name, sequence, circular, features });
}

// Builds a minimal valid .dna file. Used by the self-check below and by the
// test suite; it also documents the byte layout the parser expects.
export function buildSnapGeneDnaFixture({ sequence, circular = false, featuresXml = '' }) {
  const segments = [];
  const pushSegment = (type, dataBytes) => {
    const length = dataBytes.length;
    segments.push(type, (length >>> 24) & 0xff, (length >>> 16) & 0xff, (length >>> 8) & 0xff, length & 0xff, ...dataBytes);
  };
  const latin1 = (text) => [...text].map((ch) => ch.charCodeAt(0) & 0xff);

  // Cookie: "SnapGene" + 3 uint16 (type=1 DNA, export, import).
  pushSegment(9, [...latin1(COOKIE_MAGIC), 0, 1, 0, 0, 0, 0]);
  // DNA: flags byte then the bases.
  pushSegment(0, [circular ? 1 : 0, ...latin1(sequence)]);
  if (featuresXml) {
    pushSegment(10, latin1(featuresXml));
  }
  return new Uint8Array(segments);
}

// Run with: node examples/plugins/snapgene-dna/dna-to-genbank.js
export function demo() {
  const assert = (cond, message) => {
    if (!cond) {
      throw new Error(`dna-to-genbank self-check failed: ${message}`);
    }
  };

  const seq = 'ATGCAAACCCGGGTTTAAACCGGTTAACCGGTTAACC';
  const featuresXml = '<Features><Feature name="ori" type="rep_origin" directionality="1">'
    + '<Segment range="5-20"/></Feature>'
    + '<Feature name="revGene" type="CDS" directionality="2"><Segment range="21-30"/></Feature></Features>';
  const dna = buildSnapGeneDnaFixture({ sequence: seq, circular: true, featuresXml });

  const parsed = parseSnapGeneDna(dna);
  assert(parsed.sequence === seq, 'sequence round-trips');
  assert(parsed.circular === true, 'topology round-trips');
  assert(parsed.features.length === 2, 'both features parsed');
  assert(parsed.features[1].reverse === true, 'reverse directionality detected');

  const gbk = convertDnaToGenBank(dna, { name: 'pTest' });
  assert(/^LOCUS\s+pTest\s+37 bp/.test(gbk), 'LOCUS line has name and length');
  assert(/\bcircular\b/.test(gbk), 'circular topology emitted');
  assert(/complement\(21\.\.30\)/.test(gbk), 'reverse feature emitted as complement');
  assert(/\/label="ori"/.test(gbk), 'feature label emitted');
  // The bases survive an ORIGIN round-trip (strip digits/whitespace).
  const originSeq = gbk.split('ORIGIN')[1].replace(/[^A-Za-z]/g, '').toUpperCase();
  assert(originSeq === seq, 'ORIGIN sequence matches input');

  let rejected = false;
  try { parseSnapGeneDna(new Uint8Array([1, 2, 3])); } catch { rejected = true; }
  assert(rejected, 'a non-SnapGene file is rejected');

  return 'ok';
}

if (typeof process !== 'undefined' && process.argv?.[1]?.endsWith('dna-to-genbank.js')) {
  // eslint-disable-next-line no-console
  console.log(demo());
}
