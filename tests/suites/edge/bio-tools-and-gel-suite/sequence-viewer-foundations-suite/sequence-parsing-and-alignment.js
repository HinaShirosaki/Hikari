module.exports = function registerEdgeSequenceViewerFoundationsSuiteSequenceParsingAndAlignment(context = {}) {
  const scope = context.scope || {};
  const __dirname = context.__dirname || process.cwd();
  with (scope) {
function stripHtmlTags(html) {
  return String(html || '').replace(/<[^>]*>/g, '');
}
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
    'normalizeFeatureType',
    'getFeatureTypeGenbankKey',
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
    'summarizeFastqQuality',
    'buildAlignmentSequenceTrack',
    'buildSequenceMapSvg',
    'clampMapZoom',
    'getMapKind',
    'resolveBaseFromPoint',
    'assembleCloningPlan',
    'evaluateOverlapPcr',
    'evaluateGibsonAssembly',
    'evaluateRestrictionLigation',
    'evaluateSiteDirectedMutagenesis',
    'designCloningPrimers',
    'designPcrPrimerPair'
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
test('[EDGE] sequence-viewer builds AB1 chromatogram rows for the inline alignment track', () => {
  const track = sequenceViewerInternals.buildAlignmentSequenceTrack(
    {
      alignmentViewEnabled: true,
      activeAlignmentQueryRecord: {
        name: 'trace_with_channels',
        sourceFormat: 'ab1',
        sequence: 'AGGT',
        quality: 'IIII',
        trace: {
          positions: [5, 15, 25, 35],
          channels: [
            { base: 'A', values: [7, 9, 12, 8, 1, 0, 0, 0, 0, 0, 1, 2, 8, 2, 1, 0, 0, 0, 0, 0, 1, 2, 8, 2, 1, 0, 0, 0, 0, 0, 1, 2, 8, 2, 1, 0] },
            { base: 'C', values: [6, 3, 2, 1, 0, 1, 2, 8, 2, 1, 0, 0, 1, 2, 8, 2, 1, 0, 0, 0, 1, 2, 8, 2, 1, 0, 0, 0, 0, 0, 1, 2, 8, 2, 1, 0] },
            { base: 'G', values: [1, 4, 2, 1, 0, 0, 1, 2, 8, 2, 1, 0, 0, 1, 2, 8, 2, 1, 0, 0, 0, 1, 2, 8, 2, 1, 0, 0, 0, 1, 2, 8, 2, 1, 0, 0] },
            { base: 'T', values: [2, 1, 8, 10, 0, 0, 0, 1, 2, 8, 2, 1, 0, 0, 1, 2, 8, 2, 1, 0, 0, 0, 1, 2, 8, 2, 1, 0, 0, 0, 1, 2, 8, 2, 1, 0] }
          ]
        }
      },
      activeAlignmentResult: {
        queryName: 'trace_with_channels',
        queryFormat: 'ab1',
        orientation: 'forward',
        alignedReference: 'ACGT',
        alignedQuery: 'AGGT',
        referenceSpan: { start: 0, end: 4, wraps: false },
        identityPercent: 75,
        queryCoveragePercent: 100,
        differences: [
          {
            type: 'mismatch',
            referenceStart: 1,
            referenceEnd: 2,
            queryStart: 1,
            queryEnd: 2
          }
        ]
      }
    },
    makeAlignmentRecord('ACGT'),
    {
      lineLength: 4,
      charAdvancePx: 8
    }
  );
  const traceHtml = track.traceLines['0'];

  assert.equal(track.cells[1].kind, 'mismatch');
  assert.match(traceHtml, /sequence-viewer-inline-trace-row/);
  assert.match(traceHtml, /sequence-viewer-inline-trace-svg/);
  assert.match(traceHtml, /sequence-viewer-trace-line-a/);
  assert.match(traceHtml, /<path class="sequence-viewer-trace-line sequence-viewer-trace-line-a" d="M[^"]+ C/u);
  assert.equal(/<polyline class="sequence-viewer-trace-line/u.test(traceHtml), false);
  assert.doesNotMatch(traceHtml, /sequence-viewer-alignment-trace-svg/);
  assert.doesNotMatch(traceHtml, /sequence-viewer-trace-base-call/);
});
test('[EDGE] sequence-viewer anchors inline chromatogram calls to their reference columns', () => {
  const track = sequenceViewerInternals.buildAlignmentSequenceTrack(
    {
      alignmentViewEnabled: true,
      activeAlignmentQueryRecord: {
        name: 'offset_trace',
        sourceFormat: 'ab1',
        sequence: 'ACGT',
        quality: 'IIII',
        trace: {
          positions: [10, 20, 30, 40],
          channels: [
            { base: 'A', values: Array.from({ length: 51 }, (_item, index) => (index === 10 ? 100 : 0)) },
            { base: 'C', values: Array.from({ length: 51 }, (_item, index) => (index === 20 ? 100 : 0)) },
            { base: 'G', values: Array.from({ length: 51 }, (_item, index) => (index === 30 ? 100 : 0)) },
            { base: 'T', values: Array.from({ length: 51 }, (_item, index) => (index === 40 ? 100 : 0)) }
          ]
        }
      },
      activeAlignmentResult: {
        queryName: 'offset_trace',
        queryFormat: 'ab1',
        orientation: 'forward',
        alignedReference: 'ACGT',
        alignedQuery: 'ACGT',
        referenceSpan: { start: 4, end: 8, wraps: false },
        identityPercent: 100,
        queryCoveragePercent: 100,
        differences: []
      }
    },
    makeAlignmentRecord('NNNNACGT'),
    {
      lineLength: 8,
      charAdvancePx: 10
    }
  );
  const traceHtml = track.traceLines['0'];

  assert.match(traceHtml, /data-alignment-anchor-count="4"/);
  assert.match(traceHtml, /data-alignment-first-base-x="45"/);
  assert.match(traceHtml, /data-alignment-last-base-x="75"/);
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
test('[EDGE] sequence-viewer parseGenBankRecords preserves CDS translation qualifiers', () => {
  const parsed = sequenceViewerInternals.parseGenBankRecords(`
LOCUS       CDSSEQ         15 bp    DNA     linear   SYN 01-JAN-2026
FEATURES             Location/Qualifiers
     CDS             1..15
                     /label="cds_a"
                     /translation="M K
                     P*"
ORIGIN
        1 atgaaaccctaaacc
//
`);

  assert.equal(parsed.records.length, 1);
  assert.equal(parsed.records[0].features.length, 1);
  assert.equal(parsed.records[0].features[0].type, 'cds');
  assert.equal(parsed.records[0].features[0].translation, 'MKP*');
});
test('[EDGE] sequence-viewer parses the GenBank primer_bind key with strand direction', () => {
  const parsed = sequenceViewerInternals.parseGenBankRecords(`
LOCUS       PRIMERSEQ      24 bp    DNA     linear   SYN 01-JAN-2026
FEATURES             Location/Qualifiers
     primer_bind     complement(3..20)
                     /label="Primer_R"
ORIGIN
        1 acgtacgtac gtacgtacgt acgt
//
`);

  assert.equal(parsed.records.length, 1);
  assert.equal(parsed.records[0].features.length, 1);
  assert.equal(parsed.records[0].features[0].name, 'Primer_R');
  assert.equal(parsed.records[0].features[0].type, 'primer_bind');
  assert.equal(parsed.records[0].features[0].strand, -1);
});
  }
};
