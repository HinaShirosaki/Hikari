module.exports = function registerEdgeSequenceViewerFoundationsSuite(context = {}) {
  const scope = context.scope || {};
  const __dirname = context.__dirname || process.cwd();
  with (scope) {
test('[EDGE] sequence-viewer internal functions are exposed for unit tests', () => {
  [
    'normalizeSequenceText',
    'detectSequenceFormat',
    'parseFastaRecords',
    'parseFastqRecords',
    'parseAb1Record',
    'parseGenBankRecords',
    'parseInputRecords',
    'normalizeExternalPayload',
    'parseGenBankLocationSegments',
    'complementBase',
    'complementSequence',
    'alignSequenceToReference',
    'buildCommercialRestrictionFeatures',
    'buildOrfFeatures',
    'buildSelectedOrfTranslationContext',
    'renderDualStrandSequenceLinesHtml',
    'computeRestrictionAnnotationGeometry',
    'buildRestrictionCutPolylinePoints',
    'formatSelectedFeatureDetailHtml',
    'computeGcPercent',
    'countAmbiguousBases',
    'summarizeFastqQuality'
  ].forEach((name) => {
    assert.equal(typeof sequenceViewerInternals[name], 'function');
  });
});

function writeAscii(view, offset, text) {
  String(text || '').split('').forEach((char, index) => {
    view.setUint8(offset + index, char.charCodeAt(0));
  });
}

function parseAbifTagKey(key) {
  const match = String(key || '').trim().match(/^([A-Z0-9_]{4})(\d+)$/);
  if (!match) {
    throw new Error(`Invalid ABIF key: ${key}`);
  }
  return {
    tag: match[1],
    number: Number(match[2])
  };
}

function buildSyntheticAbif(options = {}) {
  const entries = [];
  if (options.baseKey && typeof options.baseSequence === 'string') {
    entries.push({
      key: options.baseKey,
      bytes: Uint8Array.from(String(options.baseSequence).split('').map((char) => char.charCodeAt(0))),
      elementSize: 1,
      elementCount: String(options.baseSequence).length
    });
  }
  if (options.qualityKey && Array.isArray(options.qualityValues)) {
    entries.push({
      key: options.qualityKey,
      bytes: Uint8Array.from(options.qualityValues),
      elementSize: 1,
      elementCount: options.qualityValues.length
    });
  }
  (Array.isArray(options.extraEntries) ? options.extraEntries : []).forEach((entry) => {
    entries.push({
      key: entry.key,
      bytes: entry.bytes instanceof Uint8Array ? entry.bytes : Uint8Array.from(entry.bytes || []),
      elementSize: Math.max(1, Number(entry.elementSize) || 1),
      elementCount: Math.max(0, Number(entry.elementCount) || Math.floor((entry.bytes?.length || 0) / Math.max(1, Number(entry.elementSize) || 1)))
    });
  });

  const directoryOffset = 64;
  const directorySize = entries.length * 28;
  const dataStart = directoryOffset + directorySize;
  const dataSize = entries.reduce((sum, entry) => sum + (entry.bytes.length > 4 ? entry.bytes.length : 0), 0);
  const buffer = new ArrayBuffer(dataStart + dataSize + 32);
  const view = new DataView(buffer);
  writeAscii(view, 0, 'ABIF');
  view.setUint16(4, 1, false);
  writeAscii(view, 6, 'tdir');
  view.setUint32(10, 1, false);
  view.setUint16(14, 1023, false);
  view.setUint16(16, 28, false);
  view.setUint32(18, entries.length, false);
  view.setUint32(22, directorySize, false);
  view.setUint32(26, directoryOffset, false);
  view.setUint32(30, 0, false);

  let dataCursor = dataStart;
  entries.forEach((entry, index) => {
    const entryOffset = directoryOffset + (index * 28);
    const { tag, number } = parseAbifTagKey(entry.key);
    writeAscii(view, entryOffset, tag);
    view.setUint32(entryOffset + 4, number, false);
    view.setUint16(entryOffset + 8, 2, false);
    view.setUint16(entryOffset + 10, entry.elementSize || 1, false);
    view.setUint32(entryOffset + 12, entry.elementCount || entry.bytes.length, false);
    view.setUint32(entryOffset + 16, entry.bytes.length, false);
    if (entry.bytes.length <= 4) {
      entry.bytes.forEach((value, byteIndex) => {
        view.setUint8(entryOffset + 20 + byteIndex, value);
      });
    } else {
      view.setUint32(entryOffset + 20, dataCursor, false);
      new Uint8Array(buffer, dataCursor, entry.bytes.length).set(entry.bytes);
      dataCursor += entry.bytes.length;
    }
    view.setUint32(entryOffset + 24, 0, false);
  });

  return buffer;
}

function encodeUint16Be(values) {
  const list = Array.isArray(values) ? values : [];
  const bytes = new Uint8Array(list.length * 2);
  list.forEach((value, index) => {
    const safeValue = Math.max(0, Math.round(Number(value) || 0));
    bytes[index * 2] = (safeValue >> 8) & 0xff;
    bytes[(index * 2) + 1] = safeValue & 0xff;
  });
  return bytes;
}

function makeAlignmentRecord(sequence, options = {}) {
  return {
    name: options.name || 'record',
    sourceFormat: options.sourceFormat || 'fasta',
    topology: options.topology || 'linear',
    sequence
  };
}

test('[EDGE] sequence-viewer parseFastaRecords parses multi-record input', () => {
  const parsed = sequenceViewerInternals.parseFastaRecords(`
>alpha record
ACGTNN
>beta
ttggcc
`);
  assert.equal(parsed.records.length, 2);
  assert.equal(parsed.records[0].name, 'alpha');
  assert.equal(parsed.records[0].sequence, 'ACGTNN');
  assert.equal(parsed.records[1].name, 'beta');
  assert.equal(parsed.records[1].sequence, 'TTGGCC');
});

test('[EDGE] sequence-viewer parseFastqRecords parses reads and validates quality length', () => {
  const parsed = sequenceViewerInternals.parseFastqRecords(`
@read_1
ACGT
+
IIII
@read_2
TTAA
+
####
`);
  assert.equal(parsed.records.length, 2);
  assert.equal(parsed.records[0].name, 'read_1');
  assert.equal(parsed.records[0].quality, 'IIII');
  assert.equal(parsed.records[1].sequence, 'TTAA');

  const invalid = sequenceViewerInternals.parseFastqRecords(`
@bad
ACGT
+
II
`);
  assert.equal(invalid.records.length, 0);
  assert.equal(invalid.errors.length > 0, true);
});

test('[EDGE] sequence-viewer parseAb1Record reads PBAS2 and PCON2 from a synthetic ABIF buffer', () => {
  const parsed = sequenceViewerInternals.parseAb1Record(
    buildSyntheticAbif({
      baseKey: 'PBAS2',
      baseSequence: 'ACGTN',
      qualityKey: 'PCON2',
      qualityValues: [40, 39, 38, 37, 10]
    }),
    { name: 'trace_1.ab1' }
  );

  assert.equal(parsed.format, 'ab1');
  assert.equal(parsed.records.length, 1);
  assert.equal(parsed.records[0].name, 'trace_1');
  assert.equal(parsed.records[0].sequence, 'ACGTN');
  assert.equal(parsed.records[0].quality.length, 5);
  assert.equal(parsed.warnings.length, 0);
  assert.equal(parsed.errors.length, 0);
});

test('[EDGE] sequence-viewer parseAb1Record falls back to PBAS1 and PCON1', () => {
  const parsed = sequenceViewerInternals.parseAb1Record(
    buildSyntheticAbif({
      baseKey: 'PBAS1',
      baseSequence: 'TTGCA',
      qualityKey: 'PCON1',
      qualityValues: [30, 30, 30, 30, 30]
    }),
    { name: 'legacy_trace.abi' }
  );

  assert.equal(parsed.records.length, 1);
  assert.equal(parsed.records[0].name, 'legacy_trace');
  assert.equal(parsed.records[0].sequence, 'TTGCA');
  assert.equal(parsed.records[0].quality.length, 5);
  assert.equal(parsed.errors.length, 0);
});

test('[EDGE] sequence-viewer parseAb1Record returns an error when callable base tags are missing', () => {
  const parsed = sequenceViewerInternals.parseAb1Record(
    buildSyntheticAbif({
      qualityKey: 'PCON2',
      qualityValues: [30, 30, 30]
    }),
    { name: 'missing_base.ab1' }
  );

  assert.equal(parsed.records.length, 0);
  assert.equal(parsed.errors.length > 0, true);
  assert.match(parsed.errors[0], /PBAS2|PBAS1/i);
});

test('[EDGE] sequence-viewer parseAb1Record keeps the record and warns when quality values are missing', () => {
  const parsed = sequenceViewerInternals.parseAb1Record(
    buildSyntheticAbif({
      baseKey: 'PBAS2',
      baseSequence: 'AACCGG'
    }),
    { name: 'no_quality.ab1' }
  );

  assert.equal(parsed.records.length, 1);
  assert.equal(parsed.records[0].sequence, 'AACCGG');
  assert.equal(parsed.records[0].quality, '');
  assert.equal(parsed.warnings.length > 0, true);
  assert.equal(parsed.errors.length, 0);
});

test('[EDGE] sequence-viewer parseAb1Record captures chromatogram traces and base-call positions when available', () => {
  const parsed = sequenceViewerInternals.parseAb1Record(
    buildSyntheticAbif({
      baseKey: 'PBAS2',
      baseSequence: 'ACGT',
      extraEntries: [
        {
          key: 'FWO_1',
          bytes: Uint8Array.from('GATC'.split('').map((char) => char.charCodeAt(0))),
          elementSize: 1,
          elementCount: 4
        },
        {
          key: 'PLOC2',
          bytes: encodeUint16Be([5, 15, 25, 35]),
          elementSize: 2,
          elementCount: 4
        },
        {
          key: 'DATA9',
          bytes: encodeUint16Be([1, 4, 2, 1]),
          elementSize: 2,
          elementCount: 4
        },
        {
          key: 'DATA10',
          bytes: encodeUint16Be([7, 9, 12, 8]),
          elementSize: 2,
          elementCount: 4
        },
        {
          key: 'DATA11',
          bytes: encodeUint16Be([2, 1, 8, 10]),
          elementSize: 2,
          elementCount: 4
        },
        {
          key: 'DATA12',
          bytes: encodeUint16Be([6, 3, 2, 1]),
          elementSize: 2,
          elementCount: 4
        }
      ]
    }),
    { name: 'trace_with_channels.ab1' }
  );

  assert.equal(parsed.errors.length, 0);
  assert.equal(parsed.records.length, 1);
  assert.equal(Array.isArray(parsed.records[0].trace.channels), true);
  assert.deepEqual(Array.from(parsed.records[0].trace.positions), [5, 15, 25, 35]);
  assert.equal(parsed.records[0].trace.channels.length, 4);
  const aChannel = parsed.records[0].trace.channels.find((channel) => channel.base === 'A');
  const gChannel = parsed.records[0].trace.channels.find((channel) => channel.base === 'G');
  assert.deepEqual(Array.from(aChannel.values), [7, 9, 12, 8]);
  assert.deepEqual(Array.from(gChannel.values), [1, 4, 2, 1]);
});

test('[EDGE] sequence-viewer alignSequenceToReference finds an exact forward hit', () => {
  const result = sequenceViewerInternals.alignSequenceToReference(
    makeAlignmentRecord('GGGACGTACGTCCC', { name: 'ref', sourceFormat: 'genbank' }),
    makeAlignmentRecord('ACGTACGT', { name: 'read', sourceFormat: 'ab1' })
  );

  assert.equal(result.orientation, 'forward');
  assert.equal(result.referenceSpan.start, 3);
  assert.equal(result.referenceSpan.end, 11);
  assert.equal(result.referenceSpan.wraps, false);
  assert.equal(result.identityPercent, 100);
  assert.equal(result.queryCoveragePercent, 100);
  assert.equal(result.mismatchCount, 0);
  assert.equal(result.insertionCount, 0);
  assert.equal(result.deletionCount, 0);
  assert.equal(result.differences.length, 0);
});

test('[EDGE] sequence-viewer alignSequenceToReference prefers the reverse-complement orientation when it scores best', () => {
  const result = sequenceViewerInternals.alignSequenceToReference(
    makeAlignmentRecord('TTTACGTACTTT', { name: 'ref' }),
    makeAlignmentRecord('GTACGT', { name: 'trace', sourceFormat: 'ab1' })
  );

  assert.equal(result.orientation, 'reverse');
  assert.equal(result.identityPercent, 100);
  assert.equal(result.referenceSpan.start, 3);
  assert.equal(result.referenceSpan.end, 9);
});

test('[EDGE] sequence-viewer alignSequenceToReference reports substitutions as mismatches', () => {
  const result = sequenceViewerInternals.alignSequenceToReference(
    makeAlignmentRecord('AAACCCGGGTTT', { name: 'ref' }),
    makeAlignmentRecord('CCCGAG', { name: 'trace' })
  );

  assert.equal(result.mismatchCount, 1);
  assert.equal(result.insertionCount, 0);
  assert.equal(result.deletionCount, 0);
  assert.equal(result.differences.length, 1);
  assert.equal(result.differences[0].type, 'mismatch');
  assert.equal(result.differences[0].referenceBases, 'G');
  assert.equal(result.differences[0].queryBases, 'A');
});

test('[EDGE] sequence-viewer alignSequenceToReference reports inserted query bases', () => {
  const result = sequenceViewerInternals.alignSequenceToReference(
    makeAlignmentRecord('CCCGGG', { name: 'ref' }),
    makeAlignmentRecord('CCCTGGG', { name: 'trace' })
  );

  assert.equal(result.mismatchCount, 0);
  assert.equal(result.insertionCount, 1);
  assert.equal(result.deletionCount, 0);
  assert.equal(result.differences[0].type, 'insertion');
  assert.equal(result.differences[0].queryBases, 'T');
  assert.equal(result.queryCoveragePercent < 100, true);
});

test('[EDGE] sequence-viewer alignSequenceToReference reports deleted reference bases', () => {
  const result = sequenceViewerInternals.alignSequenceToReference(
    makeAlignmentRecord('CCCTGGG', { name: 'ref' }),
    makeAlignmentRecord('CCCGGG', { name: 'trace' })
  );

  assert.equal(result.mismatchCount, 0);
  assert.equal(result.insertionCount, 0);
  assert.equal(result.deletionCount, 1);
  assert.equal(result.differences[0].type, 'deletion');
  assert.equal(result.differences[0].referenceBases, 'T');
});

test('[EDGE] sequence-viewer alignSequenceToReference places a shorter query inside a longer linear reference', () => {
  const result = sequenceViewerInternals.alignSequenceToReference(
    makeAlignmentRecord('AAAACCCCGGGGTTTT', { name: 'ref', sourceFormat: 'genbank' }),
    makeAlignmentRecord('CCCCGGGG', { name: 'trace', sourceFormat: 'ab1' })
  );

  assert.equal(result.referenceSpan.start, 4);
  assert.equal(result.referenceSpan.end, 12);
  assert.equal(result.identityPercent, 100);
});

test('[EDGE] sequence-viewer alignSequenceToReference normalizes wraparound spans on circular references', () => {
  const result = sequenceViewerInternals.alignSequenceToReference(
    makeAlignmentRecord('TTTAAACCCGGG', { name: 'plasmid', topology: 'circular', sourceFormat: 'genbank' }),
    makeAlignmentRecord('GGGTTTAAA', { name: 'trace', sourceFormat: 'ab1' })
  );

  assert.equal(result.referenceSpan.wraps, true);
  assert.equal(result.referenceSpan.start, 9);
  assert.equal(result.referenceSpan.end, 6);
  assert.equal(result.identityPercent, 100);
});

test('[EDGE] sequence-viewer alignSequenceToReference breaks score ties by identity before coverage', () => {
  const result = sequenceViewerInternals.alignSequenceToReference(
    makeAlignmentRecord('GGGAAAAAACCCGGGAAAAAAGGG', { name: 'ref' }),
    makeAlignmentRecord('AAAAAATTT', { name: 'trace' })
  );

  assert.equal(result.identityPercent, 100);
  assert.equal(result.queryCoveragePercent < 100, true);
  assert.equal(result.referenceSpan.wraps, false);
  assert.equal(result.referenceSpan.end - result.referenceSpan.start, 6);
});

test('[EDGE] sequence-viewer alignSequenceToReference prefers the forward orientation when all tie-breaks are equal', () => {
  const result = sequenceViewerInternals.alignSequenceToReference(
    makeAlignmentRecord('GGGAAGTCCCACTTGGG', { name: 'ref' }),
    makeAlignmentRecord('AAGT', { name: 'trace' })
  );

  assert.equal(result.orientation, 'forward');
  assert.equal(result.identityPercent, 100);
  assert.equal(result.queryCoveragePercent, 100);
});

test('[EDGE] sequence-viewer parseGenBankRecords parses ORIGIN and feature locations', () => {
  const parsed = sequenceViewerInternals.parseGenBankRecords(`
LOCUS       TESTSEQ        12 bp    DNA     circular SYN 01-JAN-2026
FEATURES             Location/Qualifiers
     CDS             complement(join(10..12,1..3))
                     /label="cds_a"
     promoter        4..8
                     /label="prom_a"
ORIGIN
        1 acgtttggccaa
//
`);
  assert.equal(parsed.records.length, 1);
  assert.equal(parsed.records[0].sequence, 'ACGTTTGGCCAA');
  assert.equal(parsed.records[0].features.length, 2);
  assert.equal(parsed.records[0].features[0].name, 'cds_a');
  assert.equal(parsed.records[0].features[0].strand, -1);
  assert.equal(
    JSON.stringify(parsed.records[0].features[0].segments),
    JSON.stringify([{ start: 9, end: 12 }, { start: 0, end: 3 }])
  );
});

test('[EDGE] sequence-viewer normalizeExternalPayload clamps segments and keeps metadata', () => {
  const normalized = sequenceViewerInternals.normalizeExternalPayload({
    name: 'Example payload',
    sequence: 'acgtacgt',
    topology: 'circular',
    source: 'legacy_annotation',
    features: [
      {
        name: 'hit1',
        type: 'CDS',
        strand: -1,
        source: 'legacy_annotation',
        segments: [{ start: -5, end: 4 }, { start: 6, end: 999 }]
      }
    ]
  });

  assert.equal(normalized.name, 'Example payload');
  assert.equal(normalized.sequence, 'ACGTACGT');
  assert.equal(normalized.topology, 'circular');
  assert.equal(normalized.features.length, 1);
  assert.equal(normalized.features[0].strand, -1);
  assert.equal(
    JSON.stringify(normalized.features[0].segments),
    JSON.stringify([{ start: 0, end: 4 }, { start: 6, end: 8 }])
  );
});

test('[EDGE] sequence-viewer complement mapping handles canonical and ambiguous bases', () => {
  assert.equal(sequenceViewerInternals.complementBase('A'), 'T');
  assert.equal(sequenceViewerInternals.complementBase('C'), 'G');
  assert.equal(sequenceViewerInternals.complementBase('R'), 'Y');
  assert.equal(sequenceViewerInternals.complementBase('Z'), 'N');
  assert.equal(sequenceViewerInternals.complementSequence('ACGTRYN'), 'TGCAYRN');
});

test('[EDGE] sequence-viewer buildOrfFeatures enforces default 75-aa minimum threshold', () => {
  const orf74Aa = `ATG${'AAA'.repeat(73)}TAA`;
  const orf75Aa = `ATG${'AAA'.repeat(74)}TAA`;

  const shortHits = sequenceViewerInternals.buildOrfFeatures(orf74Aa, 'linear');
  const thresholdHits = sequenceViewerInternals.buildOrfFeatures(orf75Aa, 'linear');

  assert.equal(shortHits.length, 0);
  assert.equal(thresholdHits.length > 0, true);
  assert.equal(thresholdHits.some((feature) => feature.orfLengthAa >= 75), true);
});

test('[EDGE] sequence-viewer buildOrfFeatures detects forward and reverse ORFs', () => {
  const forwardFeatures = sequenceViewerInternals.buildOrfFeatures('TTTATGAAATAGTTT', 'linear', { minAaLength: 2 });
  const reverseFeatures = sequenceViewerInternals.buildOrfFeatures('CTATTTCAT', 'linear', { minAaLength: 2 });

  assert.equal(forwardFeatures.some((feature) => feature.strand === 1), true);
  assert.equal(forwardFeatures.some((feature) => feature.type === 'open_reading_frame'), true);
  assert.equal(reverseFeatures.some((feature) => feature.strand === -1), true);

  const reverseOrf = reverseFeatures.find((feature) => feature.strand === -1);
  assert.equal(reverseOrf.orfLengthNt, 9);
  assert.equal(reverseOrf.orfLengthAa, 2);
  assert.equal(reverseOrf.orfFrame, '-1');
  assert.equal(reverseOrf.startCodon, 'ATG');
  assert.equal(reverseOrf.stopCodon, 'TAG');
  assert.equal(
    JSON.stringify(reverseOrf.segments),
    JSON.stringify([{ start: 0, end: 9 }])
  );
});

test('[EDGE] sequence-viewer buildOrfFeatures collapses nested ORFs in the same frame', () => {
  const features = sequenceViewerInternals.buildOrfFeatures('ATGAAAATGTAA', 'linear', { minAaLength: 1 });
  const plusFrameOne = features.filter((feature) => feature.strand === 1 && feature.orfFrame === '+1');

  assert.equal(plusFrameOne.length, 1);
  assert.equal(
    JSON.stringify(plusFrameOne[0].segments),
    JSON.stringify([{ start: 0, end: 12 }])
  );
  assert.equal(plusFrameOne[0].orfLengthAa, 3);
});

test('[EDGE] sequence-viewer commercial restriction builder keeps only unique cutter sites and groups same-site enzymes once', () => {
  const features = sequenceViewerInternals.buildCommercialRestrictionFeatures('GAATTCAAAAGAATTCGGATCCGACGTC', 'linear');
  const bamhiSite = features.find((feature) => feature.site === 'GGATCC');
  const aatiiSite = features.find((feature) => feature.site === 'GACGTC');

  assert.equal(features.some((feature) => feature.site === 'GAATTC'), false);
  assert.equal(Boolean(bamhiSite), true);
  assert.equal(features.filter((feature) => feature.site === 'GGATCC').length, 1);
  assert.equal(Boolean(aatiiSite), true);
  assert.equal(features.filter((feature) => feature.site === 'GACGTC').length, 1);
  assert.equal(aatiiSite.enzymeNames.includes('AatII'), true);
  assert.equal(aatiiSite.enzymeNames.includes('ZraI'), true);
  assert.equal(Array.isArray(aatiiSite.cutPatterns), true);
  assert.equal(aatiiSite.cutPatterns.length >= 2, true);
  assert.equal(aatiiSite.cut, '');
});

test('[EDGE] sequence-viewer commercial restriction builder detects reverse-oriented unique sites once', () => {
  const features = sequenceViewerInternals.buildCommercialRestrictionFeatures('TTTGAGACCAAA', 'linear');
  const bsaSite = features.find((feature) => feature.site === 'GGTCTC');

  assert.equal(Boolean(bsaSite), true);
  assert.equal(features.filter((feature) => feature.site === 'GGTCTC').length, 1);
  assert.equal(bsaSite.strand, -1);
  assert.equal(bsaSite.enzymeNames.includes('BsaI'), true);
});

test('[EDGE] sequence-viewer commercial restriction builder filters by selected vendors', () => {
  const sequence = 'TTATAAGAACAAAAAATCCCCATC';
  const both = sequenceViewerInternals.buildCommercialRestrictionFeatures(sequence, 'linear', {
    vendorFilter: { neb: true, thermo: true }
  });
  const nebOnly = sequenceViewerInternals.buildCommercialRestrictionFeatures(sequence, 'linear', {
    vendorFilter: { neb: true, thermo: false }
  });
  const thermoOnly = sequenceViewerInternals.buildCommercialRestrictionFeatures(sequence, 'linear', {
    vendorFilter: { neb: false, thermo: true }
  });
  const neither = sequenceViewerInternals.buildCommercialRestrictionFeatures(sequence, 'linear', {
    vendorFilter: { neb: false, thermo: false }
  });

  assert.equal(both.length, 3);
  assert.equal(nebOnly.length, 2);
  assert.equal(thermoOnly.length, 2);
  assert.equal(neither.length, 0);
  assert.equal(both.some((feature) => feature.name === 'AanI'), true);
  assert.equal(both.some((feature) => feature.name === 'AloI'), true);
  assert.equal(both.some((feature) => feature.name === 'BccI'), true);
  assert.equal(nebOnly.some((feature) => feature.name === 'PsiI'), true);
  assert.equal(thermoOnly.some((feature) => feature.name === 'AloI'), true);
  assert.equal(nebOnly.some((feature) => feature.name === 'AloI'), false);
  assert.equal(thermoOnly.some((feature) => feature.name === 'BccI'), false);
});

test('[EDGE] sequence-viewer restriction geometry helper is deterministic for KpnI', () => {
  const geometry = sequenceViewerInternals.computeRestrictionAnnotationGeometry(
    { start: 20, end: 26 },
    18,
    32,
    8,
    25
  );
  assert.equal(Boolean(geometry), true);
  assert.equal(geometry.overlapStart, 20);
  assert.equal(geometry.overlapEnd, 26);
  assert.equal(geometry.leftPx, 16);
  assert.equal(geometry.widthPx, 48);
  assert.equal(geometry.hasCut, true);
  assert.equal(geometry.cutLocalPx, 40);

  const points = sequenceViewerInternals.buildRestrictionCutPolylinePoints(48, 40, 40, 16, 6, 4, 14);
  const coords = points.split(/\s+/);
  assert.equal(coords.length, 4);
  const x1 = Number(coords[0].split(',')[0]);
  const x2 = Number(coords[1].split(',')[0]);
  const x3 = Number(coords[2].split(',')[0]);
  const x4 = Number(coords[3].split(',')[0]);
  assert.equal(x1, x2);
  assert.equal(x2, x3);
  assert.equal(x3, x4);
});

test('[EDGE] sequence-viewer restriction split-site draws per-line boxes and one cut marker', () => {
  const html = sequenceViewerInternals.renderDualStrandSequenceLinesHtml('A'.repeat(40), [], {
    lineLength: 24,
    charAdvancePx: 10,
    sequenceLineHeightPx: 16,
    selectedFeatureIndex: -1,
    features: [
      {
        name: 'SplitSite',
        type: 'restriction_site',
        strand: 1,
        site: 'AAAAA',
        cut: 'AA^AAA',
        segments: [{ start: 22, end: 27 }]
      }
    ]
  });
  const boxCount = (html.match(/sequence-viewer-restriction-box/g) || []).length;
  const cutCount = (html.match(/sequence-viewer-restriction-cut-svg/g) || []).length;
  assert.equal(boxCount, 2);
  assert.equal(cutCount, 1);
});

test('[EDGE] sequence-viewer restriction renderer emits px-based geometry with label, box, and cut polyline', () => {
  const html = sequenceViewerInternals.renderDualStrandSequenceLinesHtml('TTTGGTACCTTT', [], {
    lineLength: 12,
    charAdvancePx: 9,
    sequenceLineHeightPx: 16,
    selectedFeatureIndex: 0,
    features: [
      {
        name: 'KpnI',
        type: 'restriction_site',
        strand: 1,
        site: 'GGTACC',
        cut: 'GGTAC^C',
        segments: [{ start: 3, end: 9 }]
      }
    ]
  });

  assert.match(html, /sequence-viewer-restriction-label/);
  assert.match(html, /sequence-viewer-restriction-box/);
  assert.match(html, /sequence-viewer-restriction-cut-svg/);
  assert.match(html, /sequence-viewer-line-restriction-track" style="width:[0-9.]+px;height:[0-9.]+px;"/);

  const styleMatch = html.match(
    /class="sequence-viewer-restriction-annot[^"]*"\s+data-feature-index="0"\s+style="([^"]+)"/
  );
  assert.equal(Boolean(styleMatch), true);
  assert.match(styleMatch[1], /left:[0-9.]+px;/);
  assert.match(styleMatch[1], /width:[0-9.]+px;/);
  assert.equal(styleMatch[1].includes('%'), false);

  const pointsMatch = html.match(/<polyline points="([^"]+)"/);
  assert.equal(Boolean(pointsMatch), true);
  const coords = String(pointsMatch[1]).split(/\s+/);
  assert.equal(coords.length >= 4, true);
  const topCutX = Number(String(coords[0]).split(',')[0]);
  const bridgeStartX = Number(String(coords[1]).split(',')[0]);
  const bridgeEndX = Number(String(coords[2]).split(',')[0]);
  const bottomCutX = Number(String(coords[3]).split(',')[0]);
  assert.equal(Number.isFinite(topCutX), true);
  assert.equal(Number.isFinite(bridgeStartX), true);
  assert.equal(Number.isFinite(bridgeEndX), true);
  assert.equal(Number.isFinite(bottomCutX), true);
  assert.equal(topCutX, bridgeStartX);
  assert.equal(bridgeEndX, bottomCutX);
  assert.notEqual(topCutX, bottomCutX);
});

test('[EDGE] sequence-viewer line feature renderer emits px-based span bars', () => {
  const html = sequenceViewerInternals.renderDualStrandSequenceLinesHtml('ACGTACGTACGT', [], {
    lineLength: 12,
    charAdvancePx: 8,
    sequenceLineHeightPx: 16,
    selectedFeatureIndex: 0,
    features: [
      {
        name: 'Feat_A',
        type: 'promoter',
        strand: 1,
        segments: [{ start: 2, end: 10 }]
      },
      {
        name: 'Feat_B',
        type: 'cds',
        strand: 1,
        segments: [{ start: 6, end: 11 }]
      }
    ]
  });

  assert.match(html, /sequence-viewer-line-features" style="width:[0-9.]+px;height:[0-9.]+px;margin-left:[0-9.]+px;"/);
  const styleMatch = html.match(
    /class="sequence-viewer-line-feature sequence-viewer-line-feature-bar[^"]*"\s+data-feature-index="0"\s+style="([^"]+)"/
  );
  assert.equal(Boolean(styleMatch), true);
  assert.match(styleMatch[1], /left:[0-9.]+px;/);
  assert.match(styleMatch[1], /width:[0-9.]+px;/);
  assert.match(styleMatch[1], /top:[0-9.]+px;/);
  assert.match(styleMatch[1], /color:#[0-9a-f]{6};/i);
  assert.equal(styleMatch[1].includes('%'), false);
  assert.match(html, /sequence-viewer-line-feature-label/);
});

test('[EDGE] sequence-viewer ORF features render as line-local span bars', () => {
  const orfFeatures = sequenceViewerInternals.buildOrfFeatures('ATGAAATAGCCC', 'linear', { minAaLength: 2 });
  const html = sequenceViewerInternals.renderDualStrandSequenceLinesHtml('ATGAAATAGCCC', [], {
    lineLength: 12,
    charAdvancePx: 8,
    sequenceLineHeightPx: 16,
    selectedFeatureIndex: 0,
    features: orfFeatures
  });

  assert.equal(orfFeatures.length > 0, true);
  assert.match(html, /sequence-viewer-line-feature-bar/);
  assert.match(html, /ORF \+1/);
});

test('[EDGE] sequence-viewer selected ORF translation context uses genomic left-to-right anchors on reverse strand', () => {
  const sequence = 'CTATTTCAT';
  const reverseOrf = sequenceViewerInternals.buildOrfFeatures(sequence, 'linear', { minAaLength: 2 })
    .find((feature) => feature.strand === -1);
  const context = sequenceViewerInternals.buildSelectedOrfTranslationContext(sequence, reverseOrf);

  assert.equal(Boolean(context), true);
  assert.equal(context.strand, -1);
  assert.equal(context.anchors.map((anchor) => anchor.aa).join(''), 'KM');
  assert.equal(context.anchors[0].baseIndex < context.anchors[1].baseIndex, true);
});

test('[EDGE] sequence-viewer dual-strand renderer places selected ORF amino-acid row by strand', () => {
  const plusSequence = 'ATGAAATAGCCC';
  const plusOrf = sequenceViewerInternals.buildOrfFeatures(plusSequence, 'linear', { minAaLength: 2 })[0];
  const plusContext = sequenceViewerInternals.buildSelectedOrfTranslationContext(plusSequence, plusOrf);
  const plusHtml = sequenceViewerInternals.renderDualStrandSequenceLinesHtml(plusSequence, [], {
    lineLength: 12,
    charAdvancePx: 8,
    sequenceLineHeightPx: 16,
    selectedFeatureIndex: 0,
    features: [plusOrf],
    orfTranslationContext: plusContext
  });
  assert.match(plusHtml, /sequence-viewer-aa-row-plus/);
  const plusTop = plusHtml.indexOf('sequence-viewer-strand-row-top');
  const plusBottom = plusHtml.indexOf('sequence-viewer-strand-row-bottom');
  const plusAa = plusHtml.indexOf('sequence-viewer-aa-row-plus');
  assert.equal(plusTop < plusBottom && plusBottom < plusAa, true);

  const minusSequence = 'CTATTTCATCCC';
  const minusOrf = sequenceViewerInternals.buildOrfFeatures(minusSequence, 'linear', { minAaLength: 2 })
    .find((feature) => feature.strand === -1);
  const minusContext = sequenceViewerInternals.buildSelectedOrfTranslationContext(minusSequence, minusOrf);
  const minusHtml = sequenceViewerInternals.renderDualStrandSequenceLinesHtml(minusSequence, [], {
    lineLength: 12,
    charAdvancePx: 8,
    sequenceLineHeightPx: 16,
    selectedFeatureIndex: 0,
    features: [minusOrf],
    orfTranslationContext: minusContext
  });
  assert.match(minusHtml, /sequence-viewer-aa-row-minus/);
  const minusBottom = minusHtml.indexOf('sequence-viewer-strand-row-bottom');
  const minusAa = minusHtml.indexOf('sequence-viewer-aa-row-minus');
  assert.equal(minusBottom < minusAa, true);
});

test('[EDGE] sequence-viewer ORF translation context can show stop codons as TAG/TAA/TGA labels', () => {
  const sequence = 'ATGAAATAGCCC';
  const feature = sequenceViewerInternals.buildOrfFeatures(sequence, 'linear', { minAaLength: 2 })[0];
  const context = sequenceViewerInternals.buildSelectedOrfTranslationContext(sequence, feature, {
    stopVisibility: { TAG: true }
  });

  assert.equal(Boolean(context), true);
  assert.equal(context.anchors.map((anchor) => anchor.displayText).join('|'), 'M|K|TAG');
  assert.equal(context.anchors[2].isStop, true);
  assert.equal(context.anchors[2].colorKey, 'TAG');
});

test('[EDGE] sequence-viewer dual-strand renderer color-codes amino-acid cells and can render stop codon labels', () => {
  const sequence = 'ATGAAATAGCCC';
  const feature = sequenceViewerInternals.buildOrfFeatures(sequence, 'linear', { minAaLength: 2 })[0];
  const context = sequenceViewerInternals.buildSelectedOrfTranslationContext(sequence, feature, {
    stopVisibility: { TAG: true }
  });
  const html = sequenceViewerInternals.renderDualStrandSequenceLinesHtml(sequence, [], {
    lineLength: 12,
    charAdvancePx: 8,
    sequenceLineHeightPx: 16,
    selectedFeatureIndex: 0,
    features: [feature],
    orfTranslationContext: context
  });

  assert.match(html, /sequence-viewer-aa-chip/);
  assert.match(html, /data-aa-display="TAG"/);
  assert.match(html, /--sequence-viewer-aa-chip-color:#[0-9a-f]{6};/i);
});

test('[EDGE] sequence-viewer dual-strand renderer emits a cross-strand cursor at exact base boundary', () => {
  const html = sequenceViewerInternals.renderDualStrandSequenceLinesHtml('ACGTACGTACGT', [], {
    lineLength: 12,
    charAdvancePx: 9,
    sequenceLineHeightPx: 16,
    cursorBaseIndex: 5
  });
  const cursorCount = (html.match(/sequence-viewer-line-cursor/g) || []).length;
  assert.equal(cursorCount, 1);
  const cursorStyle = html.match(/class="sequence-viewer-line-cursor" style="([^"]+)"/);
  assert.equal(Boolean(cursorStyle), true);
  assert.match(cursorStyle[1], /left:[0-9.]+px;/);
  assert.match(cursorStyle[1], /height:[0-9.]+px;/);
  assert.equal(cursorStyle[1].includes('%'), false);
  assert.match(html, /data-line-start="0"/);
  assert.match(html, /data-line-end="12"/);
});

test('[EDGE] sequence-viewer dual-strand renderer shows 5/3 orientation and paired highlights', () => {
  const html = sequenceViewerInternals.renderDualStrandSequenceLinesHtml('ACGTAC', [{ start: 1, end: 4 }]);
  assert.match(html, /sequence-viewer-strand-row-top/);
  assert.match(html, /sequence-viewer-strand-row-bottom/);
  assert.match(html, /5'/);
  assert.match(html, /3'/);
  assert.match(html, /CGT/);
  assert.match(html, /GCA/);
  const highlightCount = (html.match(/sequence-viewer-seq-highlight/g) || []).length;
  assert.equal(highlightCount, 2);
});

test('[EDGE] sequence-viewer feature detail formatter includes core metadata', () => {
  const html = sequenceViewerInternals.formatSelectedFeatureDetailHtml({
    name: 'ori',
    type: 'origin',
    strand: -1,
    identity: 99.12,
    coverage: 87.56,
    source: 'legacy_annotation',
    segments: [{ start: 0, end: 4 }]
  }, 8);
  assert.match(html, /ori/);
  assert.match(html, /origin/);
  assert.match(html, /Strand:<\/strong> -/);
  assert.match(html, /99.12%/);
  assert.match(html, /87.56%/);
});

test('[EDGE] sequence-viewer feature detail formatter shows grouped restriction-site enzymes and cut patterns', () => {
  const html = sequenceViewerInternals.formatSelectedFeatureDetailHtml({
    name: 'AatII',
    type: 'restriction_site',
    strand: 1,
    source: 'commercial_restriction',
    mode: 'NEB/Thermo',
    site: 'GACGTC',
    cut: '',
    cutPatterns: ['GACGT^C', 'GAC^GTC'],
    enzymeNames: ['AatII', 'ZraI'],
    vendors: ['Thermo Fisher Scientific', 'New England Biolabs'],
    segments: [{ start: 12, end: 18 }]
  }, 40);

  assert.match(html, /Recognition Site:/);
  assert.match(html, /Cut Patterns:/);
  assert.match(html, /AatII, ZraI/);
  assert.match(html, /Thermo Fisher Scientific, New England Biolabs/);
});

test('[EDGE] sequence-viewer feature detail formatter shows ORF metadata when present', () => {
  const html = sequenceViewerInternals.formatSelectedFeatureDetailHtml({
    name: 'ORF +1',
    type: 'open_reading_frame',
    strand: 1,
    source: 'orf',
    mode: 'ORF',
    orfFrame: '+1',
    orfLengthNt: 120,
    orfLengthAa: 39,
    startCodon: 'ATG',
    stopCodon: 'TAA',
    segments: [{ start: 9, end: 129 }]
  }, 256);

  assert.match(html, /<strong>ORF:<\/strong>/);
  assert.match(html, /Frame \+1/);
  assert.match(html, /39 aa/);
  assert.match(html, /120 nt/);
  assert.match(html, /Start ATG/);
  assert.match(html, /Stop TAA/);
});
  }
};
