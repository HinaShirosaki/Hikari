module.exports = function registerBioToolsAndGelSuite(context = {}) {
  const scope = context.scope || {};
  const __dirname = context.__dirname || process.cwd();
  with (scope) {
test('[EDGE] tool-box internal functions are exposed for unit tests', () => {
  [
    'toNumber',
    'concentrationToM',
    'concentrationFromM',
    'volumeToL',
    'volumeFromL',
    'massToG',
    'massFromG',
    'cleanNucleotideSequence',
    'translateDnaSequence',
    'cleanProteinSequence',
    'parseRestrictionSites',
    'reverseTranslateProteinSequence',
    'oligoTm',
    'linearRegression',
    'peptideStats',
    'renderChemicalOptions',
    'parseCrisprTargetsInput',
    'designCrisprGuides'
  ].forEach((name) => {
    assert.equal(typeof toolBox[name], 'function');
  });
});

test('[EDGE] sequence-viewer internal functions are exposed for unit tests', () => {
  [
    'normalizeSequenceText',
    'detectSequenceFormat',
    'parseFastaRecords',
    'parseFastqRecords',
    'parseGenBankRecords',
    'parseInputRecords',
    'normalizeExternalPayload',
    'parseGenBankLocationSegments',
    'complementBase',
    'complementSequence',
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
    source: 'plannotate',
    features: [
      {
        name: 'hit1',
        type: 'CDS',
        strand: -1,
        source: 'plannotate',
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
    source: 'plannotate',
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

test('[EDGE] sequence-viewer initializes home workspace and keeps detail workspace hidden by default', () => {
  const ids = [
    'sequence-viewer-home-workspace',
    'sequence-viewer-detail-workspace',
    'sequence-viewer-home-status',
    'sequence-viewer-library-filter-saved',
    'sequence-viewer-library-filter-temporary',
    'sequence-viewer-library-list',
    'sequence-viewer-preview-host',
    'sequence-viewer-preview-meta',
    'sequence-viewer-home-paste-btn',
    'sequence-viewer-home-open-btn',
    'sequence-viewer-home-open-input',
    'sequence-viewer-back-btn',
    'sequence-viewer-save-btn',
    'sequence-viewer-save-name',
    'sequence-viewer-mode-paste',
    'sequence-viewer-mode-file',
    'sequence-viewer-paste-panel',
    'sequence-viewer-file-panel',
    'sequence-viewer-textarea',
    'sequence-viewer-file-input',
    'sequence-viewer-file-choose',
    'sequence-viewer-file-name',
    'sequence-viewer-load-btn',
    'sequence-viewer-annotate-btn',
    'sequence-viewer-clear-btn',
    'sequence-viewer-status',
    'sequence-viewer-messages',
    'sequence-viewer-record-select',
    'sequence-viewer-stat-format',
    'sequence-viewer-stat-length',
    'sequence-viewer-stat-topology',
    'sequence-viewer-stat-gc',
    'sequence-viewer-stat-ambiguous',
    'sequence-viewer-stat-quality',
    'sequence-viewer-stat-features',
    'sequence-viewer-stat-restriction-sites',
    'sequence-viewer-feature-rail-host',
    'sequence-viewer-feature-detail',
    'sequence-viewer-sequence-host'
  ];
  const document = createMockDocument(ids);
  const moduleWithDom = loadEsmStyleModule(
    path.join(__dirname, 'src', 'renderer', 'modules', 'sequence-viewer.js'),
    { document }
  );
  moduleWithDom.initSequenceViewer();

  const homeWorkspace = document.getElementById('sequence-viewer-home-workspace');
  const detailWorkspace = document.getElementById('sequence-viewer-detail-workspace');
  const openBtn = document.getElementById('sequence-viewer-home-open-btn');
  const homeStatus = document.getElementById('sequence-viewer-home-status');

  assert.equal(Boolean(homeWorkspace.hidden), false);
  assert.equal(Boolean(detailWorkspace.hidden), true);
  assert.equal(Boolean(openBtn.disabled), false);
  assert.match(homeStatus.textContent, /New or Open|Storage Folder Path|storage path|storage/i);
});

test('[EDGE] sequence-viewer loadFromExternal switches to detail workspace', () => {
  const ids = [
    'sequence-viewer-home-workspace',
    'sequence-viewer-detail-workspace',
    'sequence-viewer-home-status',
    'sequence-viewer-home-import-btn',
    'sequence-viewer-library-filter-saved',
    'sequence-viewer-library-filter-temporary',
    'sequence-viewer-library-list',
    'sequence-viewer-preview-host',
    'sequence-viewer-preview-meta',
    'sequence-viewer-home-paste-input',
    'sequence-viewer-home-paste-btn',
    'sequence-viewer-home-import-input',
    'sequence-viewer-home-open-btn',
    'sequence-viewer-home-open-input',
    'sequence-viewer-back-btn',
    'sequence-viewer-save-btn',
    'sequence-viewer-save-name',
    'sequence-viewer-mode-paste',
    'sequence-viewer-mode-file',
    'sequence-viewer-paste-panel',
    'sequence-viewer-file-panel',
    'sequence-viewer-textarea',
    'sequence-viewer-file-input',
    'sequence-viewer-file-choose',
    'sequence-viewer-file-name',
    'sequence-viewer-load-btn',
    'sequence-viewer-annotate-btn',
    'sequence-viewer-clear-btn',
    'sequence-viewer-status',
    'sequence-viewer-messages',
    'sequence-viewer-record-select',
    'sequence-viewer-stat-format',
    'sequence-viewer-stat-length',
    'sequence-viewer-stat-topology',
    'sequence-viewer-stat-gc',
    'sequence-viewer-stat-ambiguous',
    'sequence-viewer-stat-quality',
    'sequence-viewer-stat-features',
    'sequence-viewer-stat-restriction-sites',
    'sequence-viewer-feature-rail-host',
    'sequence-viewer-feature-detail',
    'sequence-viewer-sequence-host'
  ];
  const document = createMockDocument(ids);
  const moduleWithDom = loadEsmStyleModule(
    path.join(__dirname, 'src', 'renderer', 'modules', 'sequence-viewer.js'),
    { document }
  );
  const viewer = moduleWithDom.initSequenceViewer();
  viewer.loadFromExternal({
    name: 'imported',
    sequence: 'ACGTACGTACGT',
    topology: 'circular',
    source: 'external',
    features: []
  });

  const homeWorkspace = document.getElementById('sequence-viewer-home-workspace');
  const detailWorkspace = document.getElementById('sequence-viewer-detail-workspace');
  assert.equal(Boolean(homeWorkspace.hidden), true);
  assert.equal(Boolean(detailWorkspace.hidden), false);
});

test('[EDGE] sequence-viewer home paste button opens detail workspace even with empty text', () => {
  const ids = [
    'sequence-viewer-home-workspace',
    'sequence-viewer-detail-workspace',
    'sequence-viewer-home-status',
    'sequence-viewer-home-import-btn',
    'sequence-viewer-library-filter-saved',
    'sequence-viewer-library-filter-temporary',
    'sequence-viewer-library-list',
    'sequence-viewer-preview-host',
    'sequence-viewer-preview-meta',
    'sequence-viewer-home-paste-input',
    'sequence-viewer-home-paste-btn',
    'sequence-viewer-home-import-input',
    'sequence-viewer-home-open-btn',
    'sequence-viewer-home-open-input',
    'sequence-viewer-back-btn',
    'sequence-viewer-save-btn',
    'sequence-viewer-save-name',
    'sequence-viewer-mode-paste',
    'sequence-viewer-mode-file',
    'sequence-viewer-paste-panel',
    'sequence-viewer-file-panel',
    'sequence-viewer-textarea',
    'sequence-viewer-file-input',
    'sequence-viewer-file-choose',
    'sequence-viewer-file-name',
    'sequence-viewer-load-btn',
    'sequence-viewer-annotate-btn',
    'sequence-viewer-clear-btn',
    'sequence-viewer-status',
    'sequence-viewer-messages',
    'sequence-viewer-record-select',
    'sequence-viewer-stat-format',
    'sequence-viewer-stat-length',
    'sequence-viewer-stat-topology',
    'sequence-viewer-stat-gc',
    'sequence-viewer-stat-ambiguous',
    'sequence-viewer-stat-quality',
    'sequence-viewer-stat-features',
    'sequence-viewer-stat-restriction-sites',
    'sequence-viewer-feature-rail-host',
    'sequence-viewer-feature-detail',
    'sequence-viewer-sequence-host'
  ];
  const document = createMockDocument(ids);
  const moduleWithDom = loadEsmStyleModule(
    path.join(__dirname, 'src', 'renderer', 'modules', 'sequence-viewer.js'),
    { document }
  );
  moduleWithDom.initSequenceViewer();
  trigger(document.getElementById('sequence-viewer-home-paste-btn'), 'click');

  const homeWorkspace = document.getElementById('sequence-viewer-home-workspace');
  const detailWorkspace = document.getElementById('sequence-viewer-detail-workspace');
  const status = document.getElementById('sequence-viewer-status');
  assert.equal(Boolean(homeWorkspace.hidden), true);
  assert.equal(Boolean(detailWorkspace.hidden), false);
  assert.match(status.textContent, /Paste sequence text/i);
});

test('[EDGE] sequence-viewer New and Back actions use navigation callbacks', () => {
  const ids = [
    'sequence-viewer-home-workspace',
    'sequence-viewer-detail-workspace',
    'sequence-viewer-home-paste-btn',
    'sequence-viewer-back-btn'
  ];
  const document = createMockDocument(ids);
  const transitions = [];
  const moduleWithDom = loadEsmStyleModule(
    path.join(__dirname, 'src', 'renderer', 'modules', 'sequence-viewer.js'),
    { document }
  );
  moduleWithDom.initSequenceViewer({
    onNavigateDetail: () => transitions.push('detail'),
    onNavigateHome: () => transitions.push('home')
  });

  trigger(document.getElementById('sequence-viewer-home-paste-btn'), 'click');
  trigger(document.getElementById('sequence-viewer-back-btn'), 'click');
  assert.deepEqual(transitions, ['detail', 'home']);
});

test('[EDGE] sequence-viewer library native dblclick opens detail while single click only previews', async () => {
  const ids = [
    'sequence-viewer-home-workspace',
    'sequence-viewer-detail-workspace',
    'sequence-viewer-home-status',
    'sequence-viewer-library-filter-saved',
    'sequence-viewer-library-filter-temporary',
    'sequence-viewer-library-list',
    'sequence-viewer-preview-host'
  ];
  const entry = {
    id: 'entry_1',
    name: 'Entry One',
    status: 'saved',
    sourceFormat: 'GENBANK',
    topology: 'circular',
    sequenceLength: 8,
    featureCount: 0,
    updatedAt: '2026-03-01T00:00:00.000Z'
  };
  const gbkText = `
LOCUS       ENTRYONE         8 bp    DNA     circular SYN 01-JAN-2026
FEATURES             Location/Qualifiers
ORIGIN
        1 acgtacgt
//
`;
  const document = createMockDocument(ids);
  const transitions = [];
  const window = {
    enanaApi: {
      sequenceLibraryList: async () => ({ ok: true, entries: [entry] }),
      sequenceLibraryGet: async (payload) => {
        if (payload?.includeGbk) {
          return { ok: true, entry, gbkText };
        }
        return { ok: true, entry, htmlText: '<html><body>preview</body></html>' };
      }
    }
  };
  const localStorage = {
    getItem(key) {
      if (key === 'enana_state_v1') {
        return JSON.stringify({ settings: { storagePath: '/tmp/sequence-viewer-tests' } });
      }
      return null;
    }
  };
  const moduleWithDom = loadEsmStyleModule(
    path.join(__dirname, 'src', 'renderer', 'modules', 'sequence-viewer.js'),
    { document, window, localStorage }
  );
  moduleWithDom.initSequenceViewer({
    onNavigateDetail: () => transitions.push('detail')
  });
  await flushAsync();

  const libraryList = document.getElementById('sequence-viewer-library-list');
  const eventTarget = {
    closest() {
      return { dataset: { sequenceEntryId: 'entry_1' } };
    }
  };

  trigger(libraryList, 'click', { target: eventTarget, detail: 1 });
  await flushAsync();
  assert.equal(transitions.length, 0);

  trigger(libraryList, 'dblclick', { target: eventTarget, detail: 2 });
  await flushAsync();
  await flushAsync();
  assert.equal(transitions.length, 1);
});

test('[EDGE] sequence-viewer opens detail workspace when a library row is double-activated by quick repeated click', async () => {
  const ids = [
    'sequence-viewer-home-workspace',
    'sequence-viewer-detail-workspace',
    'sequence-viewer-home-status',
    'sequence-viewer-library-filter-saved',
    'sequence-viewer-library-filter-temporary',
    'sequence-viewer-library-list',
    'sequence-viewer-preview-host',
    'sequence-viewer-preview-meta',
    'sequence-viewer-home-paste-btn',
    'sequence-viewer-home-open-btn',
    'sequence-viewer-home-open-input',
    'sequence-viewer-back-btn',
    'sequence-viewer-save-btn',
    'sequence-viewer-save-name',
    'sequence-viewer-mode-paste',
    'sequence-viewer-mode-file',
    'sequence-viewer-paste-panel',
    'sequence-viewer-file-panel',
    'sequence-viewer-textarea',
    'sequence-viewer-file-input',
    'sequence-viewer-file-choose',
    'sequence-viewer-file-name',
    'sequence-viewer-load-btn',
    'sequence-viewer-annotate-btn',
    'sequence-viewer-clear-btn',
    'sequence-viewer-status',
    'sequence-viewer-messages',
    'sequence-viewer-record-select',
    'sequence-viewer-stat-format',
    'sequence-viewer-stat-length',
    'sequence-viewer-stat-topology',
    'sequence-viewer-stat-gc',
    'sequence-viewer-stat-ambiguous',
    'sequence-viewer-stat-quality',
    'sequence-viewer-stat-features',
    'sequence-viewer-stat-restriction-sites',
    'sequence-viewer-feature-rail-host',
    'sequence-viewer-feature-detail',
    'sequence-viewer-sequence-host'
  ];

  const entry = {
    id: 'entry_1',
    name: 'Entry One',
    status: 'saved',
    sourceFormat: 'GENBANK',
    topology: 'circular',
    sequenceLength: 8,
    featureCount: 0,
    updatedAt: '2026-03-01T00:00:00.000Z'
  };
  const gbkText = `
LOCUS       ENTRYONE         8 bp    DNA     circular SYN 01-JAN-2026
FEATURES             Location/Qualifiers
ORIGIN
        1 acgtacgt
//
`;
  const getCalls = [];
  const document = createMockDocument(ids);
  const window = {
    enanaApi: {
      sequenceLibraryList: async () => ({ ok: true, entries: [entry] }),
      sequenceLibraryGet: async (payload) => {
        getCalls.push(payload);
        if (payload?.includeGbk) {
          return { ok: true, entry, gbkText };
        }
        return { ok: true, entry, htmlText: '<html><body>preview</body></html>' };
      }
    }
  };
  const localStorage = {
    getItem(key) {
      if (key === 'enana_state_v1') {
        return JSON.stringify({ settings: { storagePath: '/tmp/sequence-viewer-tests' } });
      }
      return null;
    }
  };

  const moduleWithDom = loadEsmStyleModule(
    path.join(__dirname, 'src', 'renderer', 'modules', 'sequence-viewer.js'),
    { document, window, localStorage }
  );
  moduleWithDom.initSequenceViewer();
  await flushAsync();

  const libraryList = document.getElementById('sequence-viewer-library-list');
  const clickTarget = {
    closest() {
      return { dataset: { sequenceEntryId: 'entry_1' } };
    }
  };

  trigger(libraryList, 'click', { target: clickTarget });
  trigger(libraryList, 'click', { target: clickTarget });
  await flushAsync();
  await flushAsync();

  const homeWorkspace = document.getElementById('sequence-viewer-home-workspace');
  const detailWorkspace = document.getElementById('sequence-viewer-detail-workspace');
  assert.equal(Boolean(homeWorkspace.hidden), true);
  assert.equal(Boolean(detailWorkspace.hidden), false);
  assert.equal(getCalls.some((payload) => Boolean(payload?.includeGbk)), true);
});

test('[EDGE] sequence-viewer hides input composer after successful load', () => {
  const ids = [
    'sequence-viewer-home-workspace',
    'sequence-viewer-detail-workspace',
    'sequence-viewer-home-status',
    'sequence-viewer-library-filter-saved',
    'sequence-viewer-library-filter-temporary',
    'sequence-viewer-library-list',
    'sequence-viewer-preview-host',
    'sequence-viewer-preview-meta',
    'sequence-viewer-home-paste-btn',
    'sequence-viewer-home-open-btn',
    'sequence-viewer-home-open-input',
    'sequence-viewer-back-btn',
    'sequence-viewer-save-btn',
    'sequence-viewer-save-name',
    'sequence-viewer-mode-paste',
    'sequence-viewer-mode-file',
    'sequence-viewer-paste-panel',
    'sequence-viewer-file-panel',
    'sequence-viewer-textarea',
    'sequence-viewer-file-input',
    'sequence-viewer-file-choose',
    'sequence-viewer-file-name',
    'sequence-viewer-load-btn',
    'sequence-viewer-annotate-btn',
    'sequence-viewer-clear-btn',
    'sequence-viewer-status',
    'sequence-viewer-messages',
    'sequence-viewer-record-select',
    'sequence-viewer-stat-format',
    'sequence-viewer-stat-length',
    'sequence-viewer-stat-topology',
    'sequence-viewer-stat-gc',
    'sequence-viewer-stat-ambiguous',
    'sequence-viewer-stat-quality',
    'sequence-viewer-stat-features',
    'sequence-viewer-stat-restriction-sites',
    'sequence-viewer-feature-rail-host',
    'sequence-viewer-feature-detail',
    'sequence-viewer-sequence-host'
  ];
  const document = createMockDocument(ids);
  const moduleWithDom = loadEsmStyleModule(
    path.join(__dirname, 'src', 'renderer', 'modules', 'sequence-viewer.js'),
    { document }
  );
  moduleWithDom.initSequenceViewer();

  trigger(document.getElementById('sequence-viewer-home-paste-btn'), 'click');
  const textarea = document.getElementById('sequence-viewer-textarea');
  textarea.value = '>seq1\nACGTACGT\n';
  trigger(document.getElementById('sequence-viewer-load-btn'), 'click');

  const modePasteBtn = document.getElementById('sequence-viewer-mode-paste');
  const modeFileBtn = document.getElementById('sequence-viewer-mode-file');
  const loadBtn = document.getElementById('sequence-viewer-load-btn');
  const annotateBtn = document.getElementById('sequence-viewer-annotate-btn');

  assert.equal(Boolean(modePasteBtn.hidden), true);
  assert.equal(Boolean(modeFileBtn.hidden), true);
  assert.equal(Boolean(loadBtn.hidden), true);
  assert.equal(Boolean(annotateBtn.disabled), false);
});

test('[EDGE] sequence-viewer importing GenBank with features stores a temporary library entry for feature indexing', async () => {
  const ids = [
    'sequence-viewer-home-workspace',
    'sequence-viewer-detail-workspace',
    'sequence-viewer-home-status',
    'sequence-viewer-library-filter-saved',
    'sequence-viewer-library-filter-temporary',
    'sequence-viewer-library-list',
    'sequence-viewer-preview-host',
    'sequence-viewer-home-paste-btn',
    'sequence-viewer-home-open-btn',
    'sequence-viewer-home-open-input',
    'sequence-viewer-back-btn',
    'sequence-viewer-save-btn',
    'sequence-viewer-save-name',
    'sequence-viewer-mode-paste',
    'sequence-viewer-mode-file',
    'sequence-viewer-paste-panel',
    'sequence-viewer-file-panel',
    'sequence-viewer-textarea',
    'sequence-viewer-file-input',
    'sequence-viewer-file-choose',
    'sequence-viewer-file-name',
    'sequence-viewer-load-btn',
    'sequence-viewer-annotate-btn',
    'sequence-viewer-clear-btn',
    'sequence-viewer-status',
    'sequence-viewer-messages',
    'sequence-viewer-record-select',
    'sequence-viewer-stat-format',
    'sequence-viewer-stat-length',
    'sequence-viewer-stat-topology',
    'sequence-viewer-stat-gc',
    'sequence-viewer-stat-ambiguous',
    'sequence-viewer-stat-quality',
    'sequence-viewer-stat-features',
    'sequence-viewer-stat-restriction-sites',
    'sequence-viewer-feature-rail-host',
    'sequence-viewer-feature-detail',
    'sequence-viewer-sequence-host'
  ];
  const upsertCalls = [];
  const document = createMockDocument(ids);
  const window = {
    enanaApi: {
      sequenceLibraryList: async () => ({ ok: true, entries: [] }),
      sequenceLibraryUpsert: async (payload) => {
        upsertCalls.push(payload);
        return {
          ok: true,
          entry: {
            id: 'entry_imported',
            name: payload.name || 'Imported',
            status: 'temporary'
          }
        };
      }
    }
  };
  const localStorage = {
    getItem(key) {
      if (key === 'enana_state_v1') {
        return JSON.stringify({ settings: { storagePath: '/tmp/sequence-viewer-tests' } });
      }
      return null;
    }
  };
  const moduleWithDom = loadEsmStyleModule(
    path.join(__dirname, 'src', 'renderer', 'modules', 'sequence-viewer.js'),
    { document, window, localStorage }
  );
  moduleWithDom.initSequenceViewer();

  trigger(document.getElementById('sequence-viewer-home-paste-btn'), 'click');
  const textarea = document.getElementById('sequence-viewer-textarea');
  textarea.value = `
LOCUS       IMPORTED        12 bp    DNA     circular SYN 01-JAN-2026
FEATURES             Location/Qualifiers
     promoter        1..6
                     /label="shared_prom"
ORIGIN
        1 atgcgatttaaa
//
`;
  trigger(document.getElementById('sequence-viewer-load-btn'), 'click');
  await flushAsync();
  await flushAsync();

  assert.equal(upsertCalls.length, 1);
  assert.equal(Array.isArray(upsertCalls[0].features), true);
  assert.equal(upsertCalls[0].features.length, 1);
  assert.equal(upsertCalls[0].features[0].name, 'shared_prom');
  assert.equal(upsertCalls[0].sequence, 'ATGCGATTTAAA');
  assert.equal(upsertCalls[0].status, 'temporary');
});

test('[EDGE] sequence-viewer feature search can trace a stored feature back to its host vector', async () => {
  const ids = [
    'sequence-viewer-home-workspace',
    'sequence-viewer-detail-workspace',
    'sequence-viewer-home-status',
    'sequence-viewer-library-filter-saved',
    'sequence-viewer-library-filter-temporary',
    'sequence-viewer-library-list',
    'sequence-viewer-preview-host',
    'sequence-viewer-feature-search-input',
    'sequence-viewer-feature-search-btn',
    'sequence-viewer-feature-search-status',
    'sequence-viewer-feature-search-results',
    'sequence-viewer-home-paste-btn',
    'sequence-viewer-home-open-btn',
    'sequence-viewer-home-open-input',
    'sequence-viewer-back-btn',
    'sequence-viewer-save-btn',
    'sequence-viewer-save-name',
    'sequence-viewer-mode-paste',
    'sequence-viewer-mode-file',
    'sequence-viewer-paste-panel',
    'sequence-viewer-file-panel',
    'sequence-viewer-textarea',
    'sequence-viewer-file-input',
    'sequence-viewer-file-choose',
    'sequence-viewer-file-name',
    'sequence-viewer-load-btn',
    'sequence-viewer-annotate-btn',
    'sequence-viewer-clear-btn',
    'sequence-viewer-status',
    'sequence-viewer-messages',
    'sequence-viewer-record-select',
    'sequence-viewer-stat-format',
    'sequence-viewer-stat-length',
    'sequence-viewer-stat-topology',
    'sequence-viewer-stat-gc',
    'sequence-viewer-stat-ambiguous',
    'sequence-viewer-stat-quality',
    'sequence-viewer-stat-features',
    'sequence-viewer-stat-restriction-sites',
    'sequence-viewer-feature-rail-host',
    'sequence-viewer-feature-detail',
    'sequence-viewer-sequence-host'
  ];
  const entry = {
    id: 'entry_1',
    name: 'Entry One',
    status: 'saved',
    sourceFormat: 'GENBANK',
    topology: 'circular',
    sequenceLength: 12,
    featureCount: 1,
    updatedAt: '2026-03-01T00:00:00.000Z'
  };
  const searchCalls = [];
  const document = createMockDocument(ids);
  const window = {
    enanaApi: {
      sequenceLibraryList: async () => ({ ok: true, entries: [entry] }),
      sequenceLibraryGet: async (payload) => {
        if (payload?.includeGbk) {
          return {
            ok: true,
            entry,
            gbkText: `
LOCUS       ENTRYONE        12 bp    DNA     circular SYN 01-JAN-2026
FEATURES             Location/Qualifiers
     promoter        1..6
                     /label="shared_prom"
ORIGIN
        1 atgcgatttaaa
//
`
          };
        }
        return { ok: true, entry, htmlText: '<html><body>preview</body></html>' };
      },
      sequenceLibrarySearchFeatures: async (payload) => {
        searchCalls.push(payload);
        return {
          ok: true,
          results: [
            {
              id: 'feature_1',
              name: 'shared_prom',
              type: 'promoter',
              sequence: 'ATGCGA',
              hostCount: 1,
              hosts: [
                {
                  hostVectorId: 'entry_1',
                  hostVectorName: 'Entry One',
                  hostVectorStatus: 'saved',
                  locations: [{ startPos: 1, endPos: 6, strand: 1 }]
                }
              ]
            }
          ]
        };
      }
    }
  };
  const localStorage = {
    getItem(key) {
      if (key === 'enana_state_v1') {
        return JSON.stringify({ settings: { storagePath: '/tmp/sequence-viewer-tests' } });
      }
      return null;
    }
  };
  const moduleWithDom = loadEsmStyleModule(
    path.join(__dirname, 'src', 'renderer', 'modules', 'sequence-viewer.js'),
    { document, window, localStorage }
  );
  moduleWithDom.initSequenceViewer();
  await flushAsync();

  const searchInput = document.getElementById('sequence-viewer-feature-search-input');
  const searchResults = document.getElementById('sequence-viewer-feature-search-results');
  searchInput.value = 'shared_prom';
  trigger(document.getElementById('sequence-viewer-feature-search-btn'), 'click');
  await flushAsync();
  await flushAsync();

  assert.equal(searchCalls.length, 1);
  assert.equal(searchCalls[0].query, 'shared_prom');
  assert.equal(searchResults.innerHTML.includes('shared_prom'), true);
  assert.equal(searchResults.innerHTML.includes('Entry One'), true);

  const clickTarget = {
    closest() {
      return { dataset: { featureHostEntryId: 'entry_1', featureHostStatus: 'saved' } };
    }
  };
  trigger(searchResults, 'click', { target: clickTarget });
  await flushAsync();
  await flushAsync();

  const detailWorkspace = document.getElementById('sequence-viewer-detail-workspace');
  assert.equal(Boolean(detailWorkspace.hidden), false);
});

test('[EDGE] sequence-viewer protein builder searches stored features and adds translated blocks to the chain', async () => {
  const ids = [
    'sequence-viewer-home-workspace',
    'sequence-viewer-protein-builder-workspace',
    'sequence-viewer-detail-workspace',
    'sequence-viewer-home-protein-builder-btn',
    'sequence-viewer-protein-builder-back-btn',
    'sequence-viewer-protein-builder-status',
    'sequence-viewer-protein-builder-form',
    'sequence-viewer-protein-builder-name',
    'sequence-viewer-protein-builder-poi-name',
    'sequence-viewer-protein-builder-poi-sequence',
    'sequence-viewer-protein-builder-reset-btn',
    'sequence-viewer-protein-builder-add-custom-btn',
    'sequence-viewer-protein-builder-add-poi-btn',
    'sequence-viewer-protein-builder-common-blocks',
    'sequence-viewer-protein-builder-feature-search-input',
    'sequence-viewer-protein-builder-feature-search-btn',
    'sequence-viewer-protein-builder-feature-search-status',
    'sequence-viewer-protein-builder-feature-search-results',
    'sequence-viewer-protein-builder-meta',
    'sequence-viewer-protein-builder-workflow',
    'sequence-viewer-protein-builder-sequence',
    'sequence-viewer-home-status',
    'sequence-viewer-library-filter-saved',
    'sequence-viewer-library-filter-temporary',
    'sequence-viewer-save-btn'
  ];
  const searchCalls = [];
  const document = createMockDocument(ids);
  const window = {
    enanaApi: {
      sequenceLibrarySearchFeatures: async (payload) => {
        searchCalls.push(payload);
        return {
          ok: true,
          results: [
            {
              id: 'feature_protein_tag',
              name: 'stored_affinity_tag',
              type: 'cds',
              sequence: 'ATGGCCGAA',
              sequenceLength: 9,
              hostCount: 2,
              hosts: []
            }
          ]
        };
      }
    }
  };
  const localStorage = {
    getItem(key) {
      if (key === 'enana_state_v1') {
        return JSON.stringify({ settings: { storagePath: '/tmp/sequence-viewer-tests' } });
      }
      return null;
    }
  };
  const moduleWithDom = loadEsmStyleModule(
    path.join(__dirname, 'src', 'renderer', 'modules', 'sequence-viewer.js'),
    { document, window, localStorage }
  );
  moduleWithDom.initSequenceViewer();
  await flushAsync();

  trigger(document.getElementById('sequence-viewer-home-protein-builder-btn'), 'click');
  assert.equal(Boolean(document.getElementById('sequence-viewer-protein-builder-workspace').hidden), false);

  const searchInput = document.getElementById('sequence-viewer-protein-builder-feature-search-input');
  searchInput.value = 'stored_affinity_tag';
  trigger(document.getElementById('sequence-viewer-protein-builder-feature-search-btn'), 'click');
  await flushAsync();
  await flushAsync();

  assert.equal(searchCalls.length, 1);
  assert.equal(searchCalls[0].query, 'stored_affinity_tag');
  assert.equal(document.getElementById('sequence-viewer-protein-builder-feature-search-results').innerHTML.includes('stored_affinity_tag'), true);

  const addFeatureTarget = {
    closest(selector) {
      if (selector === '[data-protein-builder-feature-add-id]') {
        return { dataset: { proteinBuilderFeatureAddId: 'feature_protein_tag' } };
      }
      return null;
    }
  };
  trigger(document.getElementById('sequence-viewer-protein-builder-feature-search-results'), 'click', { target: addFeatureTarget });
  await flushAsync();

  const workflowHtml = document.getElementById('sequence-viewer-protein-builder-workflow').innerHTML;
  const sequenceHtml = document.getElementById('sequence-viewer-protein-builder-sequence').innerHTML;
  assert.equal(workflowHtml.includes('stored_affinity_tag'), true);
  assert.equal(sequenceHtml.includes('MAE'), true);
});

test('[EDGE] sequence-viewer backbone recognition adds backbone and insert features to the current record', async () => {
  const ids = [
    'sequence-viewer-recognize-backbone-btn',
    'sequence-viewer-save-btn',
    'sequence-viewer-mode-paste',
    'sequence-viewer-mode-file',
    'sequence-viewer-paste-panel',
    'sequence-viewer-file-panel',
    'sequence-viewer-textarea',
    'sequence-viewer-file-input',
    'sequence-viewer-file-choose',
    'sequence-viewer-file-name',
    'sequence-viewer-load-btn',
    'sequence-viewer-annotate-btn',
    'sequence-viewer-clear-btn',
    'sequence-viewer-status',
    'sequence-viewer-messages',
    'sequence-viewer-record-select',
    'sequence-viewer-stat-format',
    'sequence-viewer-stat-length',
    'sequence-viewer-stat-topology',
    'sequence-viewer-stat-gc',
    'sequence-viewer-stat-ambiguous',
    'sequence-viewer-stat-quality',
    'sequence-viewer-stat-features',
    'sequence-viewer-stat-restriction-sites',
    'sequence-viewer-feature-rail-host',
    'sequence-viewer-feature-detail',
    'sequence-viewer-sequence-host'
  ];
  const recognizeCalls = [];
  const document = createMockDocument(ids);
  const window = {
    enanaApi: {
      sequenceLibraryRecognizeBackbone: async (payload) => {
        recognizeCalls.push(payload);
        return {
          ok: true,
          match: {
            hostVectorId: 'entry_host',
            hostVectorName: 'HostVector',
            hostVectorStatus: 'saved',
            orientation: 'forward',
            backboneLength: 24,
            insertLength: 6,
            hostCoverage: 1,
            backboneSegments: [{ start: 0, end: 16 }, { start: 22, end: 30 }],
            insertSegments: [{ start: 16, end: 22 }]
          }
        };
      }
    }
  };
  const localStorage = {
    getItem(key) {
      if (key === 'enana_state_v1') {
        return JSON.stringify({ settings: { storagePath: '/tmp/sequence-viewer-tests' } });
      }
      return null;
    }
  };
  const moduleWithDom = loadEsmStyleModule(
    path.join(__dirname, 'src', 'renderer', 'modules', 'sequence-viewer.js'),
    { document, window, localStorage }
  );
  const viewer = moduleWithDom.initSequenceViewer();
  viewer.loadFromExternal({
    name: 'derived_vector',
    sequence: 'ATGCGTACGCTAGTTAGGAACCCCGGATCA',
    source: 'external',
    features: []
  });

  const recognizeBtn = document.getElementById('sequence-viewer-recognize-backbone-btn');
  const featureRailHost = document.getElementById('sequence-viewer-feature-rail-host');
  const featureDetail = document.getElementById('sequence-viewer-feature-detail');
  const status = document.getElementById('sequence-viewer-status');
  const statFeatures = document.getElementById('sequence-viewer-stat-features');
  const initialFeatureCount = Number(statFeatures.textContent || 0);

  trigger(recognizeBtn, 'click');
  await flushAsync();
  await flushAsync();

  assert.equal(recognizeCalls.length, 1);
  assert.equal(recognizeCalls[0].sequence, 'ATGCGTACGCTAGTTAGGAACCCCGGATCA');
  assert.equal(recognizeCalls[0].excludeEntryId, '');
  assert.equal(Number(statFeatures.textContent || 0), initialFeatureCount + 2);
  assert.match(featureRailHost.innerHTML, /Backbone \(HostVector\)/);
  assert.match(featureRailHost.innerHTML, /Insert \(HostVector\)/);
  assert.match(featureDetail.innerHTML, /Insert \(HostVector\)/);
  assert.match(status.textContent, /Save the record to persist changes/);
});

test('[EDGE] sequence-viewer annotate button enables when a record is loaded', () => {
  const ids = [
    'sequence-viewer-mode-paste',
    'sequence-viewer-mode-file',
    'sequence-viewer-paste-panel',
    'sequence-viewer-file-panel',
    'sequence-viewer-textarea',
    'sequence-viewer-file-input',
    'sequence-viewer-file-choose',
    'sequence-viewer-file-name',
    'sequence-viewer-load-btn',
    'sequence-viewer-annotate-btn',
    'sequence-viewer-clear-btn',
    'sequence-viewer-status',
    'sequence-viewer-messages',
    'sequence-viewer-record-select',
    'sequence-viewer-stat-format',
    'sequence-viewer-stat-length',
    'sequence-viewer-stat-topology',
    'sequence-viewer-stat-gc',
    'sequence-viewer-stat-ambiguous',
    'sequence-viewer-stat-quality',
    'sequence-viewer-stat-features',
    'sequence-viewer-stat-restriction-sites',
    'sequence-viewer-feature-rail-host',
    'sequence-viewer-feature-detail',
    'sequence-viewer-sequence-host'
  ];
  const document = createMockDocument(ids);
  const moduleWithDom = loadEsmStyleModule(
    path.join(__dirname, 'src', 'renderer', 'modules', 'sequence-viewer.js'),
    { document }
  );
  const viewer = moduleWithDom.initSequenceViewer();
  const annotateBtn = document.getElementById('sequence-viewer-annotate-btn');
  assert.equal(Boolean(annotateBtn.disabled), true);

  viewer.loadFromExternal({
    name: 'test',
    sequence: 'ACGTACGT',
    source: 'external',
    features: []
  });

  assert.equal(Boolean(annotateBtn.disabled), false);
});

test('[EDGE] sequence-viewer ORF toggle defaults off and controls ORF bars plus selected translation row', () => {
  const ids = [
    'sequence-viewer-home-workspace',
    'sequence-viewer-detail-workspace',
    'sequence-viewer-home-paste-btn',
    'sequence-viewer-mode-paste',
    'sequence-viewer-mode-file',
    'sequence-viewer-paste-panel',
    'sequence-viewer-file-panel',
    'sequence-viewer-textarea',
    'sequence-viewer-file-input',
    'sequence-viewer-file-choose',
    'sequence-viewer-file-name',
    'sequence-viewer-load-btn',
    'sequence-viewer-annotate-btn',
    'sequence-viewer-orf-toggle',
    'sequence-viewer-orf-stop-tag-toggle',
    'sequence-viewer-orf-stop-taa-toggle',
    'sequence-viewer-orf-stop-tga-toggle',
    'sequence-viewer-restriction-neb-toggle',
    'sequence-viewer-restriction-thermo-toggle',
    'sequence-viewer-clear-btn',
    'sequence-viewer-status',
    'sequence-viewer-messages',
    'sequence-viewer-record-select',
    'sequence-viewer-stat-format',
    'sequence-viewer-stat-length',
    'sequence-viewer-stat-topology',
    'sequence-viewer-stat-gc',
    'sequence-viewer-stat-ambiguous',
    'sequence-viewer-stat-quality',
    'sequence-viewer-stat-features',
    'sequence-viewer-stat-restriction-sites',
    'sequence-viewer-feature-rail-host',
    'sequence-viewer-feature-detail',
    'sequence-viewer-sequence-host'
  ];
  const document = createMockDocument(ids);
  const moduleWithDom = loadEsmStyleModule(
    path.join(__dirname, 'src', 'renderer', 'modules', 'sequence-viewer.js'),
    { document }
  );
  moduleWithDom.initSequenceViewer();

  trigger(document.getElementById('sequence-viewer-home-paste-btn'), 'click');
  const longOrf = `ATG${'AAA'.repeat(74)}TAA`;
  const textarea = document.getElementById('sequence-viewer-textarea');
  textarea.value = `>orf_test\n${longOrf}\n`;
  trigger(document.getElementById('sequence-viewer-load-btn'), 'click');

  const orfToggle = document.getElementById('sequence-viewer-orf-toggle');
  const orfStopTagToggle = document.getElementById('sequence-viewer-orf-stop-tag-toggle');
  const orfStopTaaToggle = document.getElementById('sequence-viewer-orf-stop-taa-toggle');
  const orfStopTgaToggle = document.getElementById('sequence-viewer-orf-stop-tga-toggle');
  const sequenceHost = document.getElementById('sequence-viewer-sequence-host');
  const statFeatures = document.getElementById('sequence-viewer-stat-features');
  assert.equal(Boolean(orfToggle.checked), false);
  assert.equal(Boolean(orfStopTagToggle.checked), false);
  assert.equal(Boolean(orfStopTaaToggle.checked), false);
  assert.equal(Boolean(orfStopTgaToggle.checked), false);
  assert.equal(statFeatures.textContent, '0');
  assert.equal(sequenceHost.innerHTML.includes('ORF +1'), false);

  orfToggle.checked = true;
  trigger(orfToggle, 'change');
  assert.equal(statFeatures.textContent, '1');
  assert.equal(sequenceHost.innerHTML.includes('ORF +1'), true);
  assert.equal(sequenceHost.innerHTML.includes('sequence-viewer-aa-row'), false);

  const firstFeature = sequenceHost.querySelector('[data-feature-index]');
  const clickTarget = {
    closest() {
      return { dataset: { featureIndex: firstFeature?.dataset?.featureIndex || '0' } };
    }
  };
  trigger(sequenceHost, 'click', { target: clickTarget });
  assert.equal(sequenceHost.innerHTML.includes('sequence-viewer-aa-row-plus'), true);
  assert.equal(sequenceHost.innerHTML.indexOf('sequence-viewer-strand-row-bottom') < sequenceHost.innerHTML.indexOf('sequence-viewer-aa-row-plus'), true);

  orfStopTaaToggle.checked = true;
  trigger(orfStopTaaToggle, 'change');
  assert.equal(sequenceHost.innerHTML.includes('data-aa-display="TAA"'), true);

  orfToggle.checked = false;
  trigger(orfToggle, 'change');
  assert.equal(statFeatures.textContent, '0');
  assert.equal(sequenceHost.innerHTML.includes('ORF +1'), false);
  assert.equal(sequenceHost.innerHTML.includes('sequence-viewer-aa-row'), false);
});

test('[EDGE] sequence-viewer restriction vendor checkboxes filter visible unique cutters', () => {
  const ids = [
    'sequence-viewer-home-workspace',
    'sequence-viewer-detail-workspace',
    'sequence-viewer-home-paste-btn',
    'sequence-viewer-mode-paste',
    'sequence-viewer-mode-file',
    'sequence-viewer-paste-panel',
    'sequence-viewer-file-panel',
    'sequence-viewer-textarea',
    'sequence-viewer-file-input',
    'sequence-viewer-file-choose',
    'sequence-viewer-file-name',
    'sequence-viewer-load-btn',
    'sequence-viewer-annotate-btn',
    'sequence-viewer-orf-toggle',
    'sequence-viewer-restriction-neb-toggle',
    'sequence-viewer-restriction-thermo-toggle',
    'sequence-viewer-clear-btn',
    'sequence-viewer-status',
    'sequence-viewer-messages',
    'sequence-viewer-record-select',
    'sequence-viewer-stat-format',
    'sequence-viewer-stat-length',
    'sequence-viewer-stat-topology',
    'sequence-viewer-stat-gc',
    'sequence-viewer-stat-ambiguous',
    'sequence-viewer-stat-quality',
    'sequence-viewer-stat-features',
    'sequence-viewer-stat-restriction-sites',
    'sequence-viewer-feature-rail-host',
    'sequence-viewer-feature-detail',
    'sequence-viewer-sequence-host'
  ];
  const document = createMockDocument(ids);
  const moduleWithDom = loadEsmStyleModule(
    path.join(__dirname, 'src', 'renderer', 'modules', 'sequence-viewer.js'),
    { document }
  );
  moduleWithDom.initSequenceViewer();

  trigger(document.getElementById('sequence-viewer-home-paste-btn'), 'click');
  const textarea = document.getElementById('sequence-viewer-textarea');
  textarea.value = '>vendor_filter\nTTATAAGAACAAAAAATCCCCATC\n';
  trigger(document.getElementById('sequence-viewer-load-btn'), 'click');

  const nebToggle = document.getElementById('sequence-viewer-restriction-neb-toggle');
  const thermoToggle = document.getElementById('sequence-viewer-restriction-thermo-toggle');
  const statRestrictionSites = document.getElementById('sequence-viewer-stat-restriction-sites');
  const sequenceHost = document.getElementById('sequence-viewer-sequence-host');

  assert.equal(Boolean(nebToggle.checked), true);
  assert.equal(Boolean(thermoToggle.checked), true);
  assert.equal(statRestrictionSites.textContent, '3');
  assert.equal(sequenceHost.innerHTML.includes('AanI'), true);
  assert.equal(sequenceHost.innerHTML.includes('AloI'), true);
  assert.equal(sequenceHost.innerHTML.includes('BccI'), true);

  thermoToggle.checked = false;
  trigger(thermoToggle, 'change');
  assert.equal(statRestrictionSites.textContent, '2');
  assert.equal(sequenceHost.innerHTML.includes('PsiI'), true);
  assert.equal(sequenceHost.innerHTML.includes('AloI'), false);
  assert.equal(sequenceHost.innerHTML.includes('BccI'), true);

  nebToggle.checked = false;
  trigger(nebToggle, 'change');
  assert.equal(statRestrictionSites.textContent, '0');
  assert.equal((sequenceHost.innerHTML.match(/sequence-viewer-restriction-annot/g) || []).length, 0);

  thermoToggle.checked = true;
  trigger(thermoToggle, 'change');
  assert.equal(statRestrictionSites.textContent, '2');
  assert.equal(sequenceHost.innerHTML.includes('AanI'), true);
  assert.equal(sequenceHost.innerHTML.includes('AloI'), true);
  assert.equal(sequenceHost.innerHTML.includes('BccI'), false);
});

test('[EDGE] sequence-viewer annotate updates only the selected record', async () => {
  const ids = [
    'sequence-viewer-mode-paste',
    'sequence-viewer-mode-file',
    'sequence-viewer-paste-panel',
    'sequence-viewer-file-panel',
    'sequence-viewer-textarea',
    'sequence-viewer-file-input',
    'sequence-viewer-file-choose',
    'sequence-viewer-file-name',
    'sequence-viewer-load-btn',
    'sequence-viewer-annotate-btn',
    'sequence-viewer-clear-btn',
    'sequence-viewer-status',
    'sequence-viewer-messages',
    'sequence-viewer-record-select',
    'sequence-viewer-stat-format',
    'sequence-viewer-stat-length',
    'sequence-viewer-stat-topology',
    'sequence-viewer-stat-gc',
    'sequence-viewer-stat-ambiguous',
    'sequence-viewer-stat-quality',
    'sequence-viewer-stat-features',
    'sequence-viewer-stat-restriction-sites',
    'sequence-viewer-feature-rail-host',
    'sequence-viewer-feature-detail',
    'sequence-viewer-sequence-host'
  ];
  const annotateCalls = [];
  const document = createMockDocument(ids);
  const window = {
    enanaApi: {
      plannotateAnnotate: async (payload) => {
        annotateCalls.push(payload);
        return {
          ok: true,
          result: {
            sequence: payload.sequenceText,
            sequenceLength: String(payload.sequenceText || '').length,
            topology: payload.topology || 'linear',
            warnings: [],
            hits: [
              {
                Feature: 'OnlySecond',
                Type: 'promoter',
                Description: 'selected record annotation',
                sframe: 1,
                qstart: 1,
                qend: 6,
                pident: 99.2,
                percmatch: 50.5,
                crossesOrigin: false,
                matchMode: 'exact'
              }
            ]
          }
        };
      }
    }
  };

  const moduleWithDom = loadEsmStyleModule(
    path.join(__dirname, 'src', 'renderer', 'modules', 'sequence-viewer.js'),
    { document, window }
  );
  moduleWithDom.initSequenceViewer();

  const textarea = document.getElementById('sequence-viewer-textarea');
  const loadBtn = document.getElementById('sequence-viewer-load-btn');
  const recordSelect = document.getElementById('sequence-viewer-record-select');
  const annotateBtn = document.getElementById('sequence-viewer-annotate-btn');
  const featureRailHost = document.getElementById('sequence-viewer-feature-rail-host');

  textarea.value = '>first\nATATATATATAT\n>second\nGGGGGGGGGGGG\n';
  trigger(loadBtn, 'click');
  recordSelect.value = '1';
  trigger(recordSelect, 'change');

  trigger(annotateBtn, 'click');
  await flushAsync();

  assert.equal(annotateCalls.length, 1);
  assert.equal(annotateCalls[0].sequenceText, 'GGGGGGGGGGGG');

  recordSelect.value = '0';
  trigger(recordSelect, 'change');
  assert.match(featureRailHost.innerHTML, /No features to display/);

  recordSelect.value = '1';
  trigger(recordSelect, 'change');
  assert.match(featureRailHost.innerHTML, /OnlySecond/);
});

test('[EDGE] sequence-viewer annotate keeps non-plannotate features and refreshes plannotate features', async () => {
  const ids = [
    'sequence-viewer-mode-paste',
    'sequence-viewer-mode-file',
    'sequence-viewer-paste-panel',
    'sequence-viewer-file-panel',
    'sequence-viewer-textarea',
    'sequence-viewer-file-input',
    'sequence-viewer-file-choose',
    'sequence-viewer-file-name',
    'sequence-viewer-load-btn',
    'sequence-viewer-annotate-btn',
    'sequence-viewer-clear-btn',
    'sequence-viewer-status',
    'sequence-viewer-messages',
    'sequence-viewer-record-select',
    'sequence-viewer-stat-format',
    'sequence-viewer-stat-length',
    'sequence-viewer-stat-topology',
    'sequence-viewer-stat-gc',
    'sequence-viewer-stat-ambiguous',
    'sequence-viewer-stat-quality',
    'sequence-viewer-stat-features',
    'sequence-viewer-stat-restriction-sites',
    'sequence-viewer-feature-rail-host',
    'sequence-viewer-feature-detail',
    'sequence-viewer-sequence-host'
  ];
  const document = createMockDocument(ids);
  const window = {
    enanaApi: {
      plannotateAnnotate: async (payload) => ({
        ok: true,
        result: {
          sequence: payload.sequenceText,
          sequenceLength: String(payload.sequenceText || '').length,
          topology: payload.topology || 'linear',
          warnings: [],
          hits: [
            {
              Feature: 'FreshAnnot',
              Type: 'cds',
              Description: 'newly annotated',
              sframe: 1,
              qstart: 4,
              qend: 10,
              pident: 98.4,
              percmatch: 44.2,
              crossesOrigin: false,
              matchMode: 'exact'
            }
          ]
        }
      })
    }
  };

  const moduleWithDom = loadEsmStyleModule(
    path.join(__dirname, 'src', 'renderer', 'modules', 'sequence-viewer.js'),
    { document, window }
  );
  const viewer = moduleWithDom.initSequenceViewer();
  viewer.loadFromExternal({
    name: 'merge_test',
    sequence: 'ATATATATATATATAT',
    source: 'external',
    features: [
      {
        id: 'existing_non_plannotate',
        name: 'KeepMe',
        type: 'promoter',
        source: 'genbank',
        strand: 1,
        segments: [{ start: 1, end: 5 }]
      },
      {
        id: 'old_plannotate',
        name: 'OldAnnot',
        type: 'cds',
        source: 'plannotate',
        strand: 1,
        segments: [{ start: 6, end: 9 }]
      }
    ]
  });

  const annotateBtn = document.getElementById('sequence-viewer-annotate-btn');
  const featureRailHost = document.getElementById('sequence-viewer-feature-rail-host');
  trigger(annotateBtn, 'click');
  await flushAsync();

  assert.match(featureRailHost.innerHTML, /KeepMe/);
  assert.match(featureRailHost.innerHTML, /FreshAnnot/);
  assert.equal(featureRailHost.innerHTML.includes('OldAnnot'), false);
});

test('[EDGE] sequence-viewer bottom-track click updates selected feature detail strip', () => {
  const ids = [
    'sequence-viewer-mode-paste',
    'sequence-viewer-mode-file',
    'sequence-viewer-paste-panel',
    'sequence-viewer-file-panel',
    'sequence-viewer-textarea',
    'sequence-viewer-file-input',
    'sequence-viewer-file-choose',
    'sequence-viewer-file-name',
    'sequence-viewer-load-btn',
    'sequence-viewer-annotate-btn',
    'sequence-viewer-clear-btn',
    'sequence-viewer-status',
    'sequence-viewer-messages',
    'sequence-viewer-record-select',
    'sequence-viewer-stat-format',
    'sequence-viewer-stat-length',
    'sequence-viewer-stat-topology',
    'sequence-viewer-stat-gc',
    'sequence-viewer-stat-ambiguous',
    'sequence-viewer-stat-quality',
    'sequence-viewer-stat-features',
    'sequence-viewer-feature-rail-host',
    'sequence-viewer-feature-detail',
    'sequence-viewer-sequence-host'
  ];
  const document = createMockDocument(ids);
  const moduleWithDom = loadEsmStyleModule(
    path.join(__dirname, 'src', 'renderer', 'modules', 'sequence-viewer.js'),
    { document }
  );
  const viewer = moduleWithDom.initSequenceViewer();
  viewer.loadFromExternal({
    name: 'test',
    sequence: 'ACGTACGT',
    source: 'plannotate',
    features: [
      {
        name: 'Feature_A',
        type: 'promoter',
        strand: 1,
        source: 'plannotate',
        segments: [{ start: 1, end: 5 }]
      }
    ]
  });

  const detail = document.getElementById('sequence-viewer-feature-detail');
  assert.match(detail.innerHTML, /Select a feature/);

  trigger(document.getElementById('sequence-viewer-feature-rail-host'), 'click', {
    target: {
      closest() {
        return { dataset: { featureIndex: '0' } };
      }
    }
  });

  assert.match(detail.innerHTML, /Feature_A/);
  assert.match(detail.innerHTML, /promoter/);
});

test('[EDGE] sequence-viewer drag selection context menu can add a feature', async () => {
  const ids = [
    'sequence-viewer-mode-paste',
    'sequence-viewer-mode-file',
    'sequence-viewer-paste-panel',
    'sequence-viewer-file-panel',
    'sequence-viewer-textarea',
    'sequence-viewer-file-input',
    'sequence-viewer-file-choose',
    'sequence-viewer-file-name',
    'sequence-viewer-load-btn',
    'sequence-viewer-annotate-btn',
    'sequence-viewer-clear-btn',
    'sequence-viewer-status',
    'sequence-viewer-messages',
    'sequence-viewer-record-select',
    'sequence-viewer-stat-format',
    'sequence-viewer-stat-length',
    'sequence-viewer-stat-topology',
    'sequence-viewer-stat-gc',
    'sequence-viewer-stat-ambiguous',
    'sequence-viewer-stat-quality',
    'sequence-viewer-stat-features',
    'sequence-viewer-feature-rail-host',
    'sequence-viewer-feature-detail',
    'sequence-viewer-sequence-host',
    'sequence-viewer-feature-context-menu',
    'sequence-viewer-feature-editor-overlay',
    'sequence-viewer-feature-editor-form',
    'sequence-viewer-feature-editor-title',
    'sequence-viewer-feature-editor-note',
    'sequence-viewer-feature-editor-name',
    'sequence-viewer-feature-editor-type',
    'sequence-viewer-feature-editor-strand',
    'sequence-viewer-feature-editor-start',
    'sequence-viewer-feature-editor-end',
    'sequence-viewer-feature-editor-description',
    'sequence-viewer-feature-editor-close',
    'sequence-viewer-feature-editor-cancel'
  ];
  const document = createMockDocument(ids);
  const moduleWithDom = loadEsmStyleModule(
    path.join(__dirname, 'src', 'renderer', 'modules', 'sequence-viewer.js'),
    { document }
  );
  const viewer = moduleWithDom.initSequenceViewer();
  viewer.loadFromExternal({
    name: 'selection_add',
    sequence: 'ACGTACGTACGT',
    source: 'external',
    features: []
  });

  const sequenceHost = document.getElementById('sequence-viewer-sequence-host');
  const contextMenu = document.getElementById('sequence-viewer-feature-context-menu');
  const featureEditorForm = document.getElementById('sequence-viewer-feature-editor-form');
  const featureEditorName = document.getElementById('sequence-viewer-feature-editor-name');
  const featureEditorType = document.getElementById('sequence-viewer-feature-editor-type');
  const featureEditorDescription = document.getElementById('sequence-viewer-feature-editor-description');
  const featureRailHost = document.getElementById('sequence-viewer-feature-rail-host');
  const featureDetail = document.getElementById('sequence-viewer-feature-detail');
  const statFeatures = document.getElementById('sequence-viewer-stat-features');
  const initialFeatureCount = Number(statFeatures.textContent || 0);

  const lineElement = {
    dataset: { lineStart: '0', lineEnd: '12' },
    querySelector() {
      return {
        getBoundingClientRect() {
          return { left: 20, width: 96 };
        }
      };
    }
  };
  const lineTarget = {
    closest(selector) {
      if (selector === '.sequence-viewer-dual-line') {
        return lineElement;
      }
      return null;
    }
  };

  trigger(sequenceHost, 'mousedown', { button: 0, clientX: 20, target: lineTarget });
  trigger(sequenceHost, 'mousemove', { clientX: 52, target: lineTarget });
  trigger(sequenceHost, 'mouseup', { target: lineTarget });
  trigger(sequenceHost, 'contextmenu', { clientX: 52, clientY: 84, target: lineTarget });

  assert.match(contextMenu.innerHTML, /Add Feature/);

  trigger(contextMenu, 'click', {
    target: {
      closest(selector) {
        if (selector === '[data-sequence-feature-action]') {
          return { dataset: { sequenceFeatureAction: 'add' } };
        }
        return null;
      }
    }
  });

  featureEditorName.value = 'Manual_A';
  featureEditorType.value = 'promoter';
  featureEditorDescription.value = 'added from selection';
  trigger(featureEditorForm, 'submit');
  await flushAsync();

  assert.equal(Number(statFeatures.textContent || 0), initialFeatureCount + 1);
  assert.match(featureRailHost.innerHTML, /Manual_A/);
  assert.match(featureDetail.innerHTML, /Manual_A/);
  assert.match(featureDetail.innerHTML, /promoter/);
});

test('[EDGE] sequence-viewer drag selection context menu can edit and delete an overlapping feature', async () => {
  const ids = [
    'sequence-viewer-mode-paste',
    'sequence-viewer-mode-file',
    'sequence-viewer-paste-panel',
    'sequence-viewer-file-panel',
    'sequence-viewer-textarea',
    'sequence-viewer-file-input',
    'sequence-viewer-file-choose',
    'sequence-viewer-file-name',
    'sequence-viewer-load-btn',
    'sequence-viewer-annotate-btn',
    'sequence-viewer-clear-btn',
    'sequence-viewer-status',
    'sequence-viewer-messages',
    'sequence-viewer-record-select',
    'sequence-viewer-stat-format',
    'sequence-viewer-stat-length',
    'sequence-viewer-stat-topology',
    'sequence-viewer-stat-gc',
    'sequence-viewer-stat-ambiguous',
    'sequence-viewer-stat-quality',
    'sequence-viewer-stat-features',
    'sequence-viewer-feature-rail-host',
    'sequence-viewer-feature-detail',
    'sequence-viewer-sequence-host',
    'sequence-viewer-feature-context-menu',
    'sequence-viewer-feature-editor-overlay',
    'sequence-viewer-feature-editor-form',
    'sequence-viewer-feature-editor-title',
    'sequence-viewer-feature-editor-note',
    'sequence-viewer-feature-editor-name',
    'sequence-viewer-feature-editor-type',
    'sequence-viewer-feature-editor-strand',
    'sequence-viewer-feature-editor-start',
    'sequence-viewer-feature-editor-end',
    'sequence-viewer-feature-editor-description',
    'sequence-viewer-feature-editor-close',
    'sequence-viewer-feature-editor-cancel'
  ];
  const document = createMockDocument(ids);
  const moduleWithDom = loadEsmStyleModule(
    path.join(__dirname, 'src', 'renderer', 'modules', 'sequence-viewer.js'),
    { document }
  );
  const viewer = moduleWithDom.initSequenceViewer();
  viewer.loadFromExternal({
    name: 'selection_edit_delete',
    sequence: 'ACGTACGTACGT',
    source: 'external',
    features: [
      {
        id: 'feature_manual_1',
        name: 'Feature_A',
        type: 'promoter',
        strand: 1,
        source: 'manual',
        segments: [{ start: 1, end: 5 }]
      }
    ]
  });

  const sequenceHost = document.getElementById('sequence-viewer-sequence-host');
  const contextMenu = document.getElementById('sequence-viewer-feature-context-menu');
  const featureEditorForm = document.getElementById('sequence-viewer-feature-editor-form');
  const featureEditorName = document.getElementById('sequence-viewer-feature-editor-name');
  const featureRailHost = document.getElementById('sequence-viewer-feature-rail-host');
  const featureDetail = document.getElementById('sequence-viewer-feature-detail');
  const statFeatures = document.getElementById('sequence-viewer-stat-features');
  const initialFeatureCount = Number(statFeatures.textContent || 0);

  const lineElement = {
    dataset: { lineStart: '0', lineEnd: '12' },
    querySelector() {
      return {
        getBoundingClientRect() {
          return { left: 20, width: 96 };
        }
      };
    }
  };
  const lineTarget = {
    closest(selector) {
      if (selector === '.sequence-viewer-dual-line') {
        return lineElement;
      }
      return null;
    }
  };

  trigger(sequenceHost, 'mousedown', { button: 0, clientX: 28, target: lineTarget });
  trigger(sequenceHost, 'mousemove', { clientX: 60, target: lineTarget });
  trigger(sequenceHost, 'mouseup', { target: lineTarget });
  trigger(sequenceHost, 'contextmenu', { clientX: 60, clientY: 84, target: lineTarget });

  assert.match(contextMenu.innerHTML, /Edit Feature_A/);

  trigger(contextMenu, 'click', {
    target: {
      closest(selector) {
        if (selector === '[data-sequence-feature-action]') {
          return { dataset: { sequenceFeatureAction: 'edit' } };
        }
        return null;
      }
    }
  });

  featureEditorName.value = 'Feature_B';
  trigger(featureEditorForm, 'submit');
  await flushAsync();

  assert.equal(Number(statFeatures.textContent || 0), initialFeatureCount);
  assert.match(featureRailHost.innerHTML, /Feature_B/);
  assert.match(featureDetail.innerHTML, /Feature_B/);

  trigger(sequenceHost, 'mousedown', { button: 0, clientX: 28, target: lineTarget });
  trigger(sequenceHost, 'mousemove', { clientX: 60, target: lineTarget });
  trigger(sequenceHost, 'mouseup', { target: lineTarget });
  trigger(sequenceHost, 'contextmenu', { clientX: 60, clientY: 84, target: lineTarget });

  trigger(contextMenu, 'click', {
    target: {
      closest(selector) {
        if (selector === '[data-sequence-feature-action]') {
          return { dataset: { sequenceFeatureAction: 'delete' } };
        }
        return null;
      }
    }
  });
  await flushAsync();

  assert.equal(Number(statFeatures.textContent || 0), initialFeatureCount - 1);
  assert.equal(featureRailHost.innerHTML.includes('Feature_B'), false);
  assert.equal(featureDetail.innerHTML.includes('Feature_B'), false);
});

[
  ['0', 0],
  ['1', 1],
  ['1.5', 1.5],
  ['-2.5', -2.5],
  ['1e3', 1000],
  ['', 0],
  [' ', 0],
  ['abc', 0],
  [null, 0],
  [undefined, 0],
  [NaN, 0],
  [Infinity, 0],
  ['0x10', 16],
  [true, 1],
  [false, 0]
].forEach(([input, expected], idx) => {
  test(`[EDGE] tool-box toNumber case ${idx + 1}`, () => {
    assert.equal(toolBox.toNumber(input), expected);
  });
});

[
  ['fM', 1e-15],
  ['pM', 1e-12],
  ['nM', 1e-9],
  ['uM', 1e-6],
  ['mM', 1e-3],
  ['M', 1]
].forEach(([unit, factor]) => {
  [-3, -1, 0, 0.25, 2, 10].forEach((value, idx) => {
    test(`[EDGE] tool-box concentration roundtrip ${unit} value case ${idx + 1}`, () => {
      const inM = toolBox.concentrationToM(value, unit);
      assertClose(inM, value * factor, 1e-12);
      const back = toolBox.concentrationFromM(inM, unit);
      assertClose(back, value, 1e-9);
    });
  });
});

[
  ['uL', 1e-6],
  ['mL', 1e-3],
  ['L', 1]
].forEach(([unit, factor]) => {
  [-2, -1, 0, 0.5, 2, 100].forEach((value, idx) => {
    test(`[EDGE] tool-box volume roundtrip ${unit} value case ${idx + 1}`, () => {
      const inL = toolBox.volumeToL(value, unit);
      assertClose(inL, value * factor, 1e-12);
      const back = toolBox.volumeFromL(inL, unit);
      assertClose(back, value, 1e-9);
    });
  });
});

[
  ['ug', 1e-6],
  ['mg', 1e-3],
  ['g', 1],
  ['kg', 1e3]
].forEach(([unit, factor]) => {
  [-1, 0, 0.1, 1, 12.5].forEach((value, idx) => {
    test(`[EDGE] tool-box mass roundtrip ${unit} value case ${idx + 1}`, () => {
      const inG = toolBox.massToG(value, unit);
      assertClose(inG, value * factor, 1e-9);
      const back = toolBox.massFromG(inG, unit);
      assertClose(back, value, 1e-9);
    });
  });
});

[
  ['ACGT', 'DNA', 'ACGT'],
  ['acgt', 'DNA', 'ACGT'],
  ['acgu', 'DNA', 'ACGT'],
  ['acgt', 'RNA', 'ACGU'],
  ['acgu', 'RNA', 'ACGU'],
  ['A C-G_T', 'DNA', 'ACGT'],
  ['NNNACGTNN', 'DNA', 'ACGT'],
  ['NNNACGUNN', 'RNA', 'ACGU'],
  ['ttrryy', 'DNA', 'TT'],
  ['uuxxyy', 'RNA', 'UU'],
  ['123456', 'DNA', ''],
  [null, 'DNA', ''],
  [undefined, 'RNA', ''],
  ['ATUG', 'RNA', 'AUUG'],
  ['ATUG', 'DNA', 'ATTG']
].forEach(([raw, type, expected], idx) => {
  test(`[EDGE] tool-box cleanNucleotideSequence case ${idx + 1}`, () => {
    assert.equal(toolBox.cleanNucleotideSequence(raw, type), expected);
  });
});

[
  ['ATGC', 'GCAT'],
  ['AAAA', 'TTTT'],
  ['CCCC', 'GGGG'],
  ['NNNN', 'NNNN'],
  ['', ''],
  ['ATGX', 'NCAT']
].forEach(([input, expected], idx) => {
  test(`[EDGE] tool-box reverseComplementDna case ${idx + 1}`, () => {
    assert.equal(toolBox.reverseComplementDna(input), expected);
  });
});

[
  { seq: 'ATGGCC', frame: 1, stopMode: 'star', protein: 'MA', codons: 2, strand: '+', remainder: 0 },
  { seq: 'ATGGCC', frame: 2, stopMode: 'star', protein: 'W', codons: 1, strand: '+', remainder: 2 },
  { seq: 'ATGGCC', frame: 3, stopMode: 'star', protein: 'G', codons: 1, strand: '+', remainder: 1 },
  { seq: 'ATGTAAATG', frame: 1, stopMode: 'trim', protein: 'M', codons: 2, strand: '+', remainder: 0 },
  { seq: 'ATGTAAATG', frame: 1, stopMode: 'star', protein: 'M*M', codons: 3, strand: '+', remainder: 0 },
  { seq: 'ATGAAA', frame: -1, stopMode: 'star', protein: 'FH', codons: 2, strand: '-', remainder: 0 },
  { seq: 'ATGAAA', frame: -2, stopMode: 'star', protein: 'F', codons: 1, strand: '-', remainder: 2 }
].forEach((scenario, idx) => {
  test(`[EDGE] tool-box translateDnaSequence case ${idx + 1}`, () => {
    const result = toolBox.translateDnaSequence(scenario.seq, scenario.frame, scenario.stopMode);
    assert.equal(result.protein, scenario.protein);
    assert.equal(result.codons, scenario.codons);
    assert.equal(result.strand, scenario.strand);
    assert.equal(result.remainderBases, scenario.remainder);
  });
});

[
  ['m k*t1', true, 'MK*T'],
  ['m k*t1', false, 'MKT'],
  ['bjouxz*', true, 'BJOUXZ*'],
  ['', true, ''],
  [null, true, '']
].forEach(([input, allowStop, expected], idx) => {
  test(`[EDGE] tool-box cleanProteinSequence case ${idx + 1}`, () => {
    assert.equal(toolBox.cleanProteinSequence(input, allowStop), expected);
  });
});

[
  ['gaattc AAGCTT ggtctc', ['GAATTC', 'AAGCTT', 'GGTCTC'], []],
  ['EcoRI NNNN atg', ['ATG'], ['ECORI', 'NNNN']],
  ['', [], []]
].forEach(([input, expectedSites, expectedIgnored], idx) => {
  test(`[EDGE] tool-box parseRestrictionSites case ${idx + 1}`, () => {
    const parsed = toolBox.parseRestrictionSites(input);
    assert.equal(JSON.stringify(parsed.sites), JSON.stringify(expectedSites));
    assert.equal(JSON.stringify(parsed.ignoredTokens), JSON.stringify(expectedIgnored));
  });
});

test('[EDGE] tool-box parseRestrictionSites expands reverse complement motifs', () => {
  const parsed = toolBox.parseRestrictionSites('GGTCTC');
  assert.equal(parsed.expandedSites.includes('GGTCTC'), true);
  assert.equal(parsed.expandedSites.includes('GAGACC'), true);
});

test('[EDGE] tool-box reverseTranslateProteinSequence basic translation is valid', () => {
  const result = toolBox.reverseTranslateProteinSequence('MRA', { organism: 'ecoli' });
  assert.equal(result.ok, true);
  assert.equal(result.dna.length, 9);
  assert.equal(toolBox.translateDnaSequence(result.dna, 1, 'star').protein, 'MRA');
});

test('[EDGE] tool-box reverseTranslateProteinSequence reflects organism codon preferences', () => {
  const ecoli = toolBox.reverseTranslateProteinSequence('RRR', { organism: 'ecoli' });
  const yeast = toolBox.reverseTranslateProteinSequence('RRR', { organism: 'yeast' });
  assert.equal(ecoli.ok, true);
  assert.equal(yeast.ok, true);
  assert.notEqual(ecoli.dna, yeast.dna);
});

[
  'mouse',
  'rat',
  'pichia',
  'arabidopsis',
  'drosophila',
  'c_elegans',
  'zebrafish',
  'pseudomonas',
  'salmonella'
].forEach((organismKey, idx) => {
  test(`[EDGE] tool-box reverseTranslateProteinSequence supports extra species case ${idx + 1}`, () => {
    const result = toolBox.reverseTranslateProteinSequence('MRT', { organism: organismKey });
    assert.equal(result.ok, true);
    assert.equal(result.organism, organismKey);
    assert.equal(toolBox.translateDnaSequence(result.dna, 1, 'star').protein, 'MRT');
  });
});

test('[EDGE] tool-box reverseTranslateProteinSequence applies new species codon preferences', () => {
  const ecoli = toolBox.reverseTranslateProteinSequence('KKK', { organism: 'ecoli' });
  const pseudomonas = toolBox.reverseTranslateProteinSequence('KKK', { organism: 'pseudomonas' });
  assert.equal(ecoli.ok, true);
  assert.equal(pseudomonas.ok, true);
  assert.notEqual(ecoli.dna, pseudomonas.dna);
});

test('[EDGE] tool-box reverseTranslateProteinSequence can avoid a requested restriction site', () => {
  const unconstrained = toolBox.reverseTranslateProteinSequence('EF', { organism: 'ecoli' });
  const constrained = toolBox.reverseTranslateProteinSequence('EF', {
    organism: 'ecoli',
    restrictionSites: ['GAATTC']
  });

  assert.equal(unconstrained.ok, true);
  assert.equal(constrained.ok, true);
  assert.equal(unconstrained.dna.includes('GAATTC'), true);
  assert.equal(constrained.dna.includes('GAATTC'), false);
  assert.equal(toolBox.translateDnaSequence(constrained.dna, 1, 'star').protein, 'EF');
});

test('[EDGE] tool-box reverseTranslateProteinSequence reports impossible restriction constraints', () => {
  const blocked = toolBox.reverseTranslateProteinSequence('M', {
    organism: 'ecoli',
    restrictionSites: ['ATG']
  });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.reason, 'restriction_conflict');
  assert.equal(blocked.blockedPosition, 1);
});

test('[EDGE] tool-box reverseTranslateProteinSequence appends stop codon when requested', () => {
  const withStop = toolBox.reverseTranslateProteinSequence('MA', {
    organism: 'ecoli',
    appendStopCodon: true
  });
  assert.equal(withStop.ok, true);
  assert.equal(withStop.protein, 'MA*');
  assert.equal(toolBox.translateDnaSequence(withStop.dna, 1, 'star').protein, 'MA*');

  const alreadyStopped = toolBox.reverseTranslateProteinSequence('MA*', {
    organism: 'ecoli',
    appendStopCodon: true
  });
  assert.equal(alreadyStopped.ok, true);
  assert.equal(alreadyStopped.protein, 'MA*');
  assert.equal(toolBox.translateDnaSequence(alreadyStopped.dna, 1, 'star').protein, 'MA*');
});

test('[EDGE] tool-box reverseTranslateProteinSequence rejects unsupported amino acids', () => {
  const result = toolBox.reverseTranslateProteinSequence('MX');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'unsupported_residue');
  assert.equal(result.unsupportedResidues.includes('X'), true);
});

[
  ['A', 'DNA', 313.21, 15400],
  ['AT', 'DNA', 617.41, 24100],
  ['AU', 'RNA', 635.38, 25300],
  ['GGCC', 'DNA', (329.21 * 2) + (289.18 * 2), (11500 * 2) + (7400 * 2)]
].forEach(([sequence, type, mwExpected, extExpected], idx) => {
  test(`[EDGE] tool-box oligo properties case ${idx + 1}`, () => {
    assertClose(toolBox.oligoMolecularWeight(sequence, type), mwExpected, 1e-4);
    assert.equal(toolBox.oligoExtinction(sequence, type), extExpected);
  });
});

[
  ['ATGC', 'DNA', 12],
  ['ATGCGCATATGCAT', 'DNA', 64.9 + (41 * (6 - 16.4)) / 14],
  ['AUGC', 'RNA', 12],
  ['', 'DNA', 0]
].forEach(([sequence, type, expected], idx) => {
  test(`[EDGE] tool-box oligoTm case ${idx + 1}`, () => {
    assertClose(toolBox.oligoTm(sequence, type), expected, 1e-6);
  });
});

[
  [[1, 2, 3], [2, 4, 6], { slope: 2, intercept: 0, rSquared: 1 }],
  [[1, 2, 3], [3, 2, 1], { slope: -1, intercept: 4, rSquared: 1 }],
  [[1, 1, 1], [2, 3, 4], null],
  [[1], [2], null],
  [[], [], null]
].forEach(([xValues, yValues, expected], idx) => {
  test(`[EDGE] tool-box linearRegression case ${idx + 1}`, () => {
    const result = toolBox.linearRegression(xValues, yValues);
    if (!expected) {
      assert.equal(result, null);
      return;
    }
    assertClose(result.slope, expected.slope, 1e-9);
    assertClose(result.intercept, expected.intercept, 1e-9);
    assertClose(result.rSquared, expected.rSquared, 1e-9);
  });
});

[
  ['a b-c_d', 'ABCD'],
  ['123abc', 'ABC'],
  ['a\nb\tc', 'ABC'],
  ['', ''],
  [null, '']
].forEach(([input, expected], idx) => {
  test(`[EDGE] tool-box cleanSequence case ${idx + 1}`, () => {
    assert.equal(toolBox.cleanSequence(input), expected);
  });
});

[
  ['AAAB', { A: 3, B: 1 }],
  ['', {}],
  ['XYZ', { X: 1, Y: 1, Z: 1 }]
].forEach(([input, expected], idx) => {
  test(`[EDGE] tool-box countResidues case ${idx + 1}`, () => {
    assert.equal(JSON.stringify(toolBox.countResidues(input)), JSON.stringify(expected));
  });
});

[
  ['', 0],
  ['A', 71.08 + 18.015],
  ['AC', 71.08 + 103.15 + 18.015],
  ['Z', 18.015]
].forEach(([input, expected], idx) => {
  test(`[EDGE] tool-box calculatePeptideMass case ${idx + 1}`, () => {
    assertClose(toolBox.calculatePeptideMass(input), expected, 1e-6);
  });
});

[
  ['KRR', 7, true],
  ['DEE', 7, false],
  ['AAAA', 7, false]
].forEach(([sequence, ph, isPositive], idx) => {
  test(`[EDGE] tool-box calculateNetCharge sign case ${idx + 1}`, () => {
    const charge = toolBox.calculateNetCharge(sequence, ph);
    assert.equal(isPositive ? charge > 0 : charge < 0, true);
  });
});

[
  ['', 0],
  ['KRR', 0],
  ['DEE', 0],
  ['ACDEFGHIKLMNPQRSTVWY', 0]
].forEach(([sequence], idx) => {
  test(`[EDGE] tool-box estimatePI bounds case ${idx + 1}`, () => {
    const value = toolBox.estimatePI(sequence);
    assert.equal(value >= 0, true);
    assert.equal(value <= 14, true);
  });
});

[
  [{ C: 1, A: 2, B: 3 }, 'A:2  B:3  C:1'],
  [{}, '']
].forEach(([counts, expected], idx) => {
  test(`[EDGE] tool-box residueSummary case ${idx + 1}`, () => {
    assert.equal(toolBox.residueSummary(counts), expected);
  });
});

[
  ['ACDE', 4],
  ['WWYYCC', 6],
  ['', 0],
  ['ABCXYZ', 6]
].forEach(([sequence, expectedLength], idx) => {
  test(`[EDGE] tool-box peptideStats case ${idx + 1}`, () => {
    const stats = toolBox.peptideStats(sequence);
    assert.equal(stats.length, expectedLength);
    assert.equal(typeof stats.mass, 'number');
    assert.equal(Array.isArray(stats.invalidResidues), true);
  });
});

test('[EDGE] tool-box renderChemicalOptions includes Custom option', () => {
  const html = toolBox.renderChemicalOptions();
  assert.match(html, /Custom<\/option>/);
  assert.match(html, /<option value="[^"]+">/);
});

test('[EDGE] tool-box parseCrisprTargetsInput parses FASTA entries and normalizes sequence', () => {
  const parsed = toolBox.parseCrisprTargetsInput(`
>Target_A
ACGTNNNN
>Target_B
acgu---
`);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].name, 'Target_A');
  assert.equal(parsed[0].sequence, 'ACGTNNNN');
  assert.equal(parsed[1].name, 'Target_B');
  assert.equal(parsed[1].sequence, 'ACGT');
});

test('[EDGE] tool-box collectCrisprPamSites finds forward NGG protospacers', () => {
  const target = {
    id: 'target-1',
    name: 'Target 1',
    sequence: 'ATATATATAGGAAAA'
  };
  const sites = toolBox.collectCrisprPamSites(target, 4, 'NGG');
  assert.equal(sites.length, 1);
  assert.equal(sites[0].strand, '+');
  assert.equal(sites[0].guideSequence, 'ATAT');
  assert.equal(sites[0].pamSequence, 'AGG');
  assert.equal(sites[0].start, 5);
  assert.equal(sites[0].end, 8);
});

test('[EDGE] tool-box computeCrisprOffTargetStats buckets mismatch counts', () => {
  const candidate = {
    key: 'k1',
    guideSequence: 'AAAAAAAAAAAAAAAAAAAA'
  };
  const background = [
    { key: 'k1', guideSequence: 'AAAAAAAAAAAAAAAAAAAA' },
    { key: 'k2', guideSequence: 'AAAAAAAAAAAAAAAAAAAA' },
    { key: 'k3', guideSequence: 'CAAAAAAAAAAAAAAAAAAA' },
    { key: 'k4', guideSequence: 'CCAAAAAAAAAAAAAAAAAA' },
    { key: 'k5', guideSequence: 'CCCAAAAAAAAAAAAAAAAA' },
    { key: 'k6', guideSequence: 'CCCCAAAAAAAAAAAAAAAA' }
  ];
  const stats = toolBox.computeCrisprOffTargetStats(candidate, background, 1);
  assert.equal(stats.mismatchCounts.exact, 1);
  assert.equal(stats.mismatchCounts.mismatch1, 1);
  assert.equal(stats.mismatchCounts.mismatch2, 1);
  assert.equal(stats.mismatchCounts.mismatch3, 1);
  assertClose(stats.offTargetRate, 27.84, 1e-9);
  assertClose(stats.specificityScore, 72.16, 1e-9);
});

test('[EDGE] tool-box designCrisprGuides returns ranked sgRNA candidates', () => {
  const selectedTargets = [{
    id: 'target-1',
    name: 'Target 1',
    sequence: 'ATATATATAGGAAAA'
  }];
  const result = toolBox.designCrisprGuides({
    selectedTargets,
    backgroundTargets: selectedTargets,
    guideLength: 4,
    pamPattern: toolBox.normalizeIupacPattern('NGG'),
    minGc: 0,
    maxGc: 100,
    topCount: 10,
    genomeMultiplier: 1
  });
  assert.equal(result.totalPamMatches, 1);
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].guideSequence, 'ATAT');
  assert.equal(result.candidates[0].pamSequence, 'AGG');
  assertClose(result.candidates[0].offTargetRate, 0, 1e-9);
  assertClose(result.candidates[0].specificityScore, 100, 1e-9);
});

test('[EDGE] tool-box designCrisprGuides respects GC filtering', () => {
  const selectedTargets = [{
    id: 'target-1',
    name: 'Target 1',
    sequence: 'ATATATATAGGAAAA'
  }];
  const result = toolBox.designCrisprGuides({
    selectedTargets,
    backgroundTargets: selectedTargets,
    guideLength: 4,
    pamPattern: toolBox.normalizeIupacPattern('NGG'),
    minGc: 50,
    maxGc: 100,
    topCount: 10,
    genomeMultiplier: 1
  });
  assert.equal(result.totalPamMatches, 1);
  assert.equal(result.filteredCandidateCount, 0);
  assert.equal(result.candidates.length, 0);
});

test('[EDGE] gel-analysis internal functions are exposed for unit tests', () => {
  [
    'clamp',
    'round',
    'mean',
    'confidenceLabel',
    'normalizeManualOverrides',
    'safeFilePart',
    'escapeCsv',
    'computeHistogramPercentiles',
    'normalizeArrayRange',
    'buildGaussianKernel',
    'gaussianBlur2d',
    'linearRegression',
    'buildCalibration',
    'applyNormalization',
    'clusterBandsAcrossLanes',
    'computeLaneConfidence',
    'interpretLane'
  ].forEach((name) => {
    assert.equal(typeof gelAnalysisInternals[name], 'function');
  });
});

[
  [0, 0, 10, 0],
  [5, 0, 10, 5],
  [-1, 0, 10, 0],
  [11, 0, 10, 10],
  [3.3, 0, 4, 3.3],
  [NaN, 0, 4, NaN]
].forEach(([value, min, max, expected], idx) => {
  test(`[EDGE] gel-analysis clamp case ${idx + 1}`, () => {
    const result = gelAnalysisInternals.clamp(value, min, max);
    if (Number.isNaN(expected)) {
      assert.equal(Number.isNaN(result), true);
      return;
    }
    assert.equal(result, expected);
  });
});

[
  [1.23456, 2, 1.23],
  [1.23556, 2, 1.24],
  [-1.23556, 2, -1.24],
  [0, 4, 0],
  [Infinity, 2, null],
  [NaN, 2, null]
].forEach(([value, digits, expected], idx) => {
  test(`[EDGE] gel-analysis round case ${idx + 1}`, () => {
    assert.equal(gelAnalysisInternals.round(value, digits), expected);
  });
});

[
  [[], 0],
  [[1], 1],
  [[1, 2, 3], 2],
  [[-1, 1], 0]
].forEach(([values, expected], idx) => {
  test(`[EDGE] gel-analysis mean case ${idx + 1}`, () => {
    assertClose(gelAnalysisInternals.mean(values), expected, 1e-9);
  });
});

[
  [0.9, 'high'],
  [0.75, 'high'],
  [0.74, 'medium'],
  [0.5, 'medium'],
  [0.49, 'low'],
  [0, 'low']
].forEach(([score, expected], idx) => {
  test(`[EDGE] gel-analysis confidenceLabel case ${idx + 1}`, () => {
    assert.equal(gelAnalysisInternals.confidenceLabel(score), expected);
  });
});

test('[EDGE] gel-analysis createEmptyManualOverrides baseline shape', () => {
  const value = gelAnalysisInternals.createEmptyManualOverrides();
  assert.equal(JSON.stringify(Object.keys(value).sort()), JSON.stringify(['addedBands', 'ladderBands', 'ladderBandsDone', 'ladderLane', 'laneSegmentation']));
  assert.equal(Array.isArray(value.laneSegmentation.dividers), true);
  assert.equal(value.laneSegmentation.dividers.length, 0);
});

[
  {
    raw: {
      laneSegmentation: {
        gelLeft: '10.9',
        gelRight: '100.3',
        dividers: [30, '30', 50, -3, 120, 50],
        dividerDone: 'yes',
        bandTop: '5',
        bandBottom: '20'
      },
      addedBands: [{ laneIndex: '2', pixelY: '33.2' }, { laneIndex: -1, pixelY: 5 }],
      ladderLane: '3',
      ladderBands: [{ pixelY: 80.2, mw: 50 }, { pixelY: 10.2, mw: 150 }, { pixelY: 2, mw: 0 }],
      ladderBandsDone: 1
    },
    expectation: (value) => {
      assert.equal(value.laneSegmentation.gelLeft, 10);
      assert.equal(value.laneSegmentation.gelRight, 100);
      assert.equal(JSON.stringify(value.laneSegmentation.dividers), JSON.stringify([30, 50, 120]));
      assert.equal(value.addedBands.length, 2);
      assert.equal(value.ladderLane, 3);
      assert.equal(JSON.stringify(value.ladderBands.map((item) => item.mw)), JSON.stringify([150, 50]));
      assert.equal(value.ladderBandsDone, true);
    }
  },
  {
    raw: null,
    expectation: (value) => {
      assert.deepEqual(value, gelAnalysisInternals.createEmptyManualOverrides());
    }
  }
].forEach((scenario, idx) => {
  test(`[EDGE] gel-analysis normalizeManualOverrides case ${idx + 1}`, () => {
    const value = gelAnalysisInternals.normalizeManualOverrides(scenario.raw);
    scenario.expectation(value);
  });
});

[
  [' file name ', 'fallback', 'file-name'],
  ['***', 'fallback', 'fallback'],
  ['a/b/c', 'fallback', 'a-b-c'],
  ['A__B', 'fallback', 'A__B'],
  ['', 'fallback', 'fallback']
].forEach(([raw, fallback, expected], idx) => {
  test(`[EDGE] gel-analysis safeFilePart case ${idx + 1}`, () => {
    assert.equal(gelAnalysisInternals.safeFilePart(raw, fallback), expected);
  });
});

[
  ['a,b', '"a,b"'],
  ['a"b', '"a""b"'],
  ['line\nbreak', '"line\nbreak"'],
  ['plain', 'plain'],
  [null, '']
].forEach(([value, expected], idx) => {
  test(`[EDGE] gel-analysis escapeCsv case ${idx + 1}`, () => {
    assert.equal(gelAnalysisInternals.escapeCsv(value), expected);
  });
});

[
  new Float32Array(100).fill(0),
  new Float32Array(100).fill(1),
  Float32Array.from({ length: 100 }, (_, i) => i / 99),
  Float32Array.from({ length: 100 }, (_, i) => (i % 2 ? 1 : 0))
].forEach((data, idx) => {
  test(`[EDGE] gel-analysis histogram percentile shape case ${idx + 1}`, () => {
    const { low, high } = gelAnalysisInternals.computeHistogramPercentiles(data, 2, 98);
    assert.equal(low >= 0 && low <= 1, true);
    assert.equal(high >= 0 && high <= 1, true);
    assert.equal(high >= low, true);
  });
});

[
  new Float32Array(32).fill(0.5),
  Float32Array.from({ length: 32 }, (_, i) => i / 31),
  Float32Array.from({ length: 32 }, (_, i) => ((i % 5) / 4))
].forEach((data, idx) => {
  test(`[EDGE] gel-analysis normalizeArrayRange bounds case ${idx + 1}`, () => {
    const out = gelAnalysisInternals.normalizeArrayRange(data);
    assert.equal(out.length, data.length);
    out.forEach((value) => {
      assert.equal(value >= 0 && value <= 1, true);
    });
  });
});

[
  0.01,
  0.1,
  0.5,
  1,
  2
].forEach((sigma, idx) => {
  test(`[EDGE] gel-analysis buildGaussianKernel case ${idx + 1}`, () => {
    const { kernel, radius } = gelAnalysisInternals.buildGaussianKernel(sigma);
    assert.equal(kernel.length, (radius * 2) + 1);
    const sum = [...kernel].reduce((acc, value) => acc + value, 0);
    assertClose(sum, 1, 1e-5);
  });
});

[
  { width: 4, height: 4, sigma: 1.2, value: 0.7 },
  { width: 5, height: 3, sigma: 0.8, value: 0.2 }
].forEach((scenario, idx) => {
  test(`[EDGE] gel-analysis gaussianBlur2d preserves constant field case ${idx + 1}`, () => {
    const data = new Float32Array(scenario.width * scenario.height).fill(scenario.value);
    const out = gelAnalysisInternals.gaussianBlur2d(data, scenario.width, scenario.height, scenario.sigma);
    out.forEach((value) => {
      assertClose(value, scenario.value, 1e-5);
    });
  });
});

[
  [[1, 2, 3], [2, 4, 6], 2, 0],
  [[1, 2, 3], [3, 2, 1], -1, 4],
  [[1], [2], null, null],
  [[1, 1, 1], [2, 3, 4], null, null]
].forEach(([xValues, yValues, slope, intercept], idx) => {
  test(`[EDGE] gel-analysis linearRegression case ${idx + 1}`, () => {
    const value = gelAnalysisInternals.linearRegression(xValues, yValues);
    if (slope === null) {
      assert.equal(value, null);
      return;
    }
    assertClose(value.slope, slope, 1e-9);
    assertClose(value.intercept, intercept, 1e-9);
    assert.equal(value.r2 >= 0 && value.r2 <= 1, true);
  });
});

test('[EDGE] gel-analysis buildCalibration supports manual ladder bands', () => {
  const result = gelAnalysisInternals.buildCalibration(
    [],
    1,
    [250, 150, 100],
    200,
    [
      { pixelY: 10, mw: 250 },
      { pixelY: 50, mw: 150 },
      { pixelY: 90, mw: 100 }
    ]
  );
  assert.equal(result.ok, true);
  assert.equal(result.manual, true);
  assert.equal(result.matchedPoints.length, 3);
});

test('[EDGE] gel-analysis buildCalibration auto-ladder fallback and failure modes', () => {
  const lanes = [
    {
      index: 0,
      bands: [
        { pixelY: 10 },
        { pixelY: 40 },
        { pixelY: 80 }
      ]
    }
  ];
  const ok = gelAnalysisInternals.buildCalibration(lanes, 1, [250, 150, 100], 200, []);
  assert.equal(ok.ok, true);
  assert.equal(ok.manual, false);

  const fail = gelAnalysisInternals.buildCalibration([], 1, [250, 150, 100], 200, []);
  assert.equal(fail.ok, false);
});

test('[EDGE] gel-analysis applyCalibrationToBands sets estimatedMw', () => {
  const lanes = [{ bands: [{ pixelY: 10 }, { pixelY: 50 }] }];
  gelAnalysisInternals.applyCalibrationToBands(lanes, { ok: true, slope: -1, intercept: 2 }, 100);
  assert.equal(Number.isFinite(lanes[0].bands[0].estimatedMw), true);
  assert.equal(Number.isFinite(lanes[0].bands[1].estimatedMw), true);
});

[
  'max',
  'total-lane'
].forEach((mode, idx) => {
  test(`[EDGE] gel-analysis applyNormalization mode case ${idx + 1}`, () => {
    const lanes = [{
      bands: [
        { rawIntensity: 2 },
        { rawIntensity: 6 }
      ]
    }];
    gelAnalysisInternals.applyNormalization(lanes, mode);
    lanes[0].bands.forEach((band) => {
      assert.equal(band.normalizedIntensity === null || (band.normalizedIntensity >= 0 && band.normalizedIntensity <= 1), true);
    });
  });
});

[
  {
    hasMwCalibration: true,
    lanes: [
      { index: 0, imageHeight: 100, bands: [{ bandIndex: 0, estimatedMw: 100, pixelY: 20 }] },
      { index: 1, imageHeight: 100, bands: [{ bandIndex: 0, estimatedMw: 103, pixelY: 30 }] }
    ],
    minGroups: 1
  },
  {
    hasMwCalibration: false,
    lanes: [
      { index: 0, imageHeight: 100, bands: [{ bandIndex: 0, estimatedMw: null, pixelY: 20 }] },
      { index: 1, imageHeight: 100, bands: [{ bandIndex: 0, estimatedMw: null, pixelY: 22 }] },
      { index: 2, imageHeight: 100, bands: [{ bandIndex: 0, estimatedMw: null, pixelY: 80 }] }
    ],
    minGroups: 2
  }
].forEach((scenario, idx) => {
  test(`[EDGE] gel-analysis clusterBandsAcrossLanes case ${idx + 1}`, () => {
    const groups = gelAnalysisInternals.clusterBandsAcrossLanes(scenario.lanes, scenario.hasMwCalibration);
    assert.equal(groups.length >= scenario.minGroups, true);
    scenario.lanes.forEach((lane) => {
      lane.bands.forEach((band) => {
        assert.equal(typeof band.groupId, 'string');
        assert.equal(typeof band.groupLabel, 'string');
      });
    });
  });
});

test('[EDGE] gel-analysis computeLaneConfidence handles empty and populated lanes', () => {
  const empty = gelAnalysisInternals.computeLaneConfidence({ bands: [] }, 0.5);
  assertClose(empty.score, 0.25, 1e-9);
  assert.equal(empty.label, 'low');

  const populated = gelAnalysisInternals.computeLaneConfidence({
    bands: [
      { sharpness: 0.2, snr: 10, saturationFraction: 0.01 },
      { sharpness: 0.15, snr: 8, saturationFraction: 0.02 }
    ]
  }, 0.95);
  assert.equal(populated.score > 0.5, true);
  assert.equal(['medium', 'high'].includes(populated.label), true);
});

[
  {
    analysisType: 'sds-page',
    lane: { bands: [{ rawIntensity: 10 }, { rawIntensity: 9 }], rowActivityFraction: 0.5 },
    expectWarning: true
  },
  {
    analysisType: 'western',
    lane: { bands: [{ rawIntensity: 10, normalizedIntensity: 0.1 }], rowActivityFraction: 0.5 },
    expectWarning: true
  },
  {
    analysisType: 'agarose',
    lane: { bands: [{ rawIntensity: 10 }], rowActivityFraction: 0.1 },
    expectWarning: false
  }
].forEach((scenario, idx) => {
  test(`[EDGE] gel-analysis interpretLane case ${idx + 1}`, () => {
    const result = gelAnalysisInternals.interpretLane(scenario);
    assert.equal(Array.isArray(result.notes), true);
    assert.equal(Array.isArray(result.warnings), true);
    assert.equal(result.warnings.length > 0, scenario.expectWarning);
  });
});

  }
};
