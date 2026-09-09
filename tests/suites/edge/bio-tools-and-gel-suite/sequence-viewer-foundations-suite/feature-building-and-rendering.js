module.exports = function registerEdgeSequenceViewerFoundationsSuiteFeatureBuildingAndRendering(context = {}) {
  const scope = context.scope || {};
  const __dirname = context.__dirname || process.cwd();
  with (scope) {
function stripHtmlTags(html) {
  return String(html || '').replace(/<[^>]*>/g, '');
}
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
test('[EDGE] sequence-viewer normalizes common feature type aliases', () => {
  assert.equal(sequenceViewerInternals.normalizeFeatureType('CDS'), 'cds');
  assert.equal(sequenceViewerInternals.normalizeFeatureType('coding sequence'), 'cds');
  assert.equal(sequenceViewerInternals.normalizeFeatureType("5' UTR"), '5_utr');
  assert.equal(sequenceViewerInternals.normalizeFeatureType('origin of replication'), 'rep_origin');
  assert.equal(sequenceViewerInternals.normalizeFeatureType('primer binding site'), 'primer_bind');
  assert.equal(sequenceViewerInternals.normalizeFeatureType('primer_binding'), 'primer_bind');
  assert.equal(sequenceViewerInternals.isPrimerBindingFeature('primer_bind'), true);
  assert.equal(sequenceViewerInternals.isPrimerBindingFeature('primer binding region'), true);
  assert.equal(sequenceViewerInternals.isPrimerBindingFeature('promoter'), false);
  assert.equal(sequenceViewerInternals.getFeatureTypeGenbankKey('cds'), 'CDS');
  assert.equal(sequenceViewerInternals.getFeatureTypeGenbankKey('3 utr'), "3'UTR");
  assert.equal(sequenceViewerInternals.getFeatureTypeGenbankKey('mrna'), 'mRNA');
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
test('[EDGE] sequence-viewer buildOrfFeatures updates when active ORF stop codons change', () => {
  const sequence = 'ATGAAATGACCCTAA';
  const allStops = sequenceViewerInternals.buildOrfFeatures(sequence, 'linear', { minAaLength: 2 });
  const taaOnly = sequenceViewerInternals.buildOrfFeatures(sequence, 'linear', {
    minAaLength: 2,
    stopCodons: { TAG: false, TAA: true, TGA: false }
  });
  const noStops = sequenceViewerInternals.buildOrfFeatures(sequence, 'linear', {
    minAaLength: 2,
    stopCodons: { TAG: false, TAA: false, TGA: false }
  });

  assert.equal(allStops[0].stopCodon, 'TGA');
  assert.equal(allStops[0].orfLengthNt, 9);
  assert.equal(taaOnly[0].stopCodon, 'TAA');
  assert.equal(taaOnly[0].orfLengthNt, 15);
  assert.equal(noStops.length, 0);
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
  assert.match(html, /sequence-viewer-line-restriction-track" style="width:[0-9.]+px;height:[0-9.]+px;[^"]*"/);

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
test('[EDGE] sequence-viewer restriction renderer stacks overlapping site labels into lanes', () => {
  const html = sequenceViewerInternals.renderDualStrandSequenceLinesHtml('TTTGAATTCTTT', [], {
    lineLength: 12,
    charAdvancePx: 10,
    sequenceLineHeightPx: 16,
    selectedFeatureIndex: -1,
    features: [
      {
        name: 'EcoRI',
        type: 'restriction_site',
        strand: 1,
        site: 'GAATTC',
        cut: 'G^AATTC',
        segments: [{ start: 3, end: 9 }]
      },
      {
        name: 'EcoRI-alt',
        type: 'restriction_site',
        strand: 1,
        site: 'GAATTC',
        cut: 'G^AATTC',
        segments: [{ start: 3, end: 9 }]
      }
    ]
  });

  assert.match(html, /--sequence-viewer-restriction-lanes:2;/);
  assert.match(html, /class="sequence-viewer-strand-pair" style="padding-top:[0-9.]+px;"/);

  const styles = [...html.matchAll(
    /class="sequence-viewer-restriction-annot[^"]*"\s+data-feature-index="\d+"\s+style="([^"]+)"/g
  )].map((match) => match[1]);
  assert.equal(styles.length, 2);
  assert.equal(styles.every((style) => !/top:-[0-9.]+px;/.test(style)), true);
  assert.equal(styles.some((style) => /--sequence-viewer-restriction-label-stack-offset:0\.000px;/.test(style)), true);
  assert.equal(styles.some((style) => /--sequence-viewer-restriction-label-stack-offset:(?!0\.000)[0-9.]+px;/.test(style)), true);
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
  assert.match(styleMatch[1], /--sequence-viewer-feature-color:#[0-9a-f]{6};/i);
  assert.equal(styleMatch[1].includes('background:'), false);
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
test('[EDGE] sequence-viewer primer features render as directional 5-prime to 3-prime oligos', () => {
  const html = sequenceViewerInternals.renderDualStrandSequenceLinesHtml('A'.repeat(48), [], {
    lineLength: 48,
    charAdvancePx: 8,
    sequenceLineHeightPx: 16,
    features: [
      {
        name: 'Forward primer',
        type: 'primer_binding',
        strand: 1,
        segments: [{ start: 2, end: 20 }]
      },
      {
        name: 'Reverse primer',
        type: 'primer_bind',
        strand: -1,
        segments: [{ start: 24, end: 44 }]
      }
    ]
  });

  assert.match(html, /sequence-viewer-line-feature-primer-forward/);
  assert.match(html, /sequence-viewer-line-feature-primer-reverse/);

  // Which chrome carries the direction depends on OLIGO_PRIMER_STYLE, so the
  // contract is checked against whichever drawing the viewer is built with.
  if (/sequence-viewer-line-feature-primer-oligo/.test(html)) {
    assert.equal((html.match(/<polygon class="sequence-viewer-primer-outline"/g) || []).length, 2);
    // 18 nt forward plus 20 nt reverse, each base drawn inside the outline.
    assert.equal((html.match(/<text class="sequence-viewer-primer-nt/g) || []).length, 38);
    return;
  }

  assert.equal((html.match(/sequence-viewer-primer-end-five/g) || []).length, 2);
  assert.equal((html.match(/sequence-viewer-primer-end-three/g) || []).length, 2);
  assert.equal((html.match(/sequence-viewer-primer-arrow/g) || []).length, 2);
  assert.match(html, /5′/);
  assert.match(html, /3′/);
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
  assert.deepEqual(Array.from(context.anchors[0].codonPositions), [5, 4, 3]);
});
test('[EDGE] sequence-viewer amino-acid substitution chooses the nearest codon on both strands', () => {
  assert.equal(sequenceViewerInternals.chooseClosestAminoAcidCodon('AAA', 'E'), 'GAA');

  const plus = sequenceViewerInternals.buildAminoAcidSubstitution('ATGAAATAG', {
    codonPositions: [3, 4, 5],
    currentAminoAcid: 'K',
    currentCodon: 'AAA',
    strand: 1,
    targetAminoAcid: 'E'
  });
  assert.equal(plus.targetCodon, 'GAA');
  assert.equal(plus.changedBaseCount, 1);
  assert.equal(plus.nextSequence, 'ATGGAATAG');

  const minus = sequenceViewerInternals.buildAminoAcidSubstitution('CTATTTCAT', {
    codonPositions: [5, 4, 3],
    currentAminoAcid: 'K',
    currentCodon: 'AAA',
    strand: -1,
    targetAminoAcid: 'E'
  });
  assert.equal(minus.targetCodon, 'GAA');
  assert.equal(minus.changedBaseCount, 1);
  assert.equal(minus.nextSequence, 'CTATTCCAT');
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
test('[EDGE] sequence-viewer dual-strand renderer puts primers on the strand side they anneal to and names a wrapped primer once', () => {
  const html = sequenceViewerInternals.renderDualStrandSequenceLinesHtml('ACGT'.repeat(24), [], {
    lineLength: 48,
    charAdvancePx: 8,
    sequenceLineHeightPx: 16,
    selectedFeatureIndex: -1,
    features: [
      { name: 'His6', type: 'CDS', strand: 1, segments: [{ start: 4, end: 22 }] },
      { name: 'fwdP', type: 'primer_bind', strand: 1, segments: [{ start: 2, end: 24 }] },
      // Wraps the 48 nt line boundary, so it renders as two fragments.
      { name: 'revP', type: 'primer_bind', strand: -1, segments: [{ start: 38, end: 60 }] }
    ]
  });

  // Forward primer track sits above the top strand, reverse below the bottom strand,
  // and plain features keep the shared track under the whole duplex.
  const forward = html.indexOf('sequence-viewer-line-feature-primer-forward');
  const top = html.indexOf('sequence-viewer-strand-row-top');
  const bottom = html.indexOf('sequence-viewer-strand-row-bottom');
  const reverse = html.indexOf('sequence-viewer-line-feature-primer-reverse');
  const feature = html.indexOf('sequence-viewer-line-feature-bar');
  assert.equal(forward < top && top < bottom && bottom < reverse && reverse < feature, true);

  // Every primer stays clickable on both fragments, but is labelled only once.
  assert.equal((html.match(/sequence-viewer-line-feature-primer-reverse/g) || []).length, 2);
  [0, 1, 2].forEach((index) => {
    assert.match(html, new RegExp(`data-feature-index="${index}"`));
  });
  assert.equal((html.match(/>revP</g) || []).length, 1);
  assert.equal((html.match(/>fwdP</g) || []).length, 1);
});
test('[EDGE] sequence-viewer dual-strand renderer renders an explicit reference-guide-read alignment block', () => {
  const html = sequenceViewerInternals.renderDualStrandSequenceLinesHtml('AAACCCGGGTTT', [], {
    lineLength: 12,
    charAdvancePx: 8,
    sequenceLineHeightPx: 16,
    alignmentSequenceTrack: {
      cells: [
        null,
        null,
        null,
        { base: 'C', kind: 'match' },
        { base: 'C', kind: 'match' },
        { base: 'C', kind: 'match' },
        { base: 'A', kind: 'mismatch' },
        { base: 'G', kind: 'match' },
        { base: '-', kind: 'deletion' }
      ]
    }
  });

  assert.match(html, /sequence-viewer-alignment-comparison/);
  assert.match(html, /sequence-viewer-alignment-reference-row/);
  assert.match(html, /sequence-viewer-alignment-guide-row/);
  assert.match(html, /sequence-viewer-alignment-query-row/);
  assert.match(html, /sequence-viewer-alignment-query-base-mismatch/);
  assert.match(html, /sequence-viewer-alignment-query-base-deletion/);
  assert.match(html, /sequence-viewer-alignment-query-base-gap/);
  assert.match(html, /sequence-viewer-alignment-reference-base-mismatch/);
  assert.match(html, /sequence-viewer-alignment-guide-base-match/);
  assert.match(html, /sequence-viewer-alignment-guide-base-mismatch/);
  assert.match(html, /sequence-viewer-alignment-guide-base-deletion/);

  const topIndex = html.indexOf('sequence-viewer-strand-row-top');
  const referenceIndex = html.indexOf('sequence-viewer-alignment-reference-row');
  const guideIndex = html.indexOf('sequence-viewer-alignment-guide-row');
  const readIndex = html.indexOf('sequence-viewer-alignment-query-row');
  const bottomIndex = html.indexOf('sequence-viewer-strand-row-bottom');
  assert.equal(topIndex < referenceIndex && referenceIndex < guideIndex && guideIndex < readIndex && readIndex < bottomIndex, true);
});
test('[EDGE] sequence-viewer dual-strand renderer inserts AB1 trace between reference and aligned query rows', () => {
  const cells = Array.from({ length: 60 }, () => ({ base: 'A', kind: 'match' }));
  const html = sequenceViewerInternals.renderDualStrandSequenceLinesHtml('A'.repeat(60), [], {
    lineLength: 24,
    charAdvancePx: 8,
    sequenceLineHeightPx: 16,
    alignmentSequenceTrack: {
      cells,
      traceLines: {
        0: '<div class="sequence-viewer-strand-row sequence-viewer-inline-trace-row" data-trace-line="0"></div>',
        24: '<div class="sequence-viewer-strand-row sequence-viewer-inline-trace-row" data-trace-line="24"></div>'
      }
    }
  });

  assert.equal((html.match(/sequence-viewer-inline-trace-row/g) || []).length, 2);
  assert.doesNotMatch(html, /sequence-viewer-inline-alignment-trace/);
  assert.doesNotMatch(html, /sequence-viewer-alignment-trace-scroll/);

  const firstLineStart = html.indexOf('data-line-start="0"');
  const secondLineStart = html.indexOf('data-line-start="24"');
  const thirdLineStart = html.indexOf('data-line-start="48"');
  const firstLineHtml = html.slice(firstLineStart, secondLineStart);
  const secondLineHtml = html.slice(secondLineStart, thirdLineStart);
  const firstTopIndex = firstLineHtml.indexOf('sequence-viewer-strand-row-top');
  const firstTraceIndex = firstLineHtml.indexOf('sequence-viewer-inline-trace-row');
  const firstReferenceIndex = firstLineHtml.indexOf('sequence-viewer-alignment-reference-row');
  const firstGuideIndex = firstLineHtml.indexOf('sequence-viewer-alignment-guide-row');
  const firstAlignmentIndex = firstLineHtml.indexOf('sequence-viewer-alignment-query-row');
  const firstBottomIndex = firstLineHtml.indexOf('sequence-viewer-strand-row-bottom');
  const secondTopIndex = secondLineHtml.indexOf('sequence-viewer-strand-row-top');
  const secondTraceIndex = secondLineHtml.indexOf('sequence-viewer-inline-trace-row');
  const secondReferenceIndex = secondLineHtml.indexOf('sequence-viewer-alignment-reference-row');
  const secondGuideIndex = secondLineHtml.indexOf('sequence-viewer-alignment-guide-row');
  const secondAlignmentIndex = secondLineHtml.indexOf('sequence-viewer-alignment-query-row');
  const secondBottomIndex = secondLineHtml.indexOf('sequence-viewer-strand-row-bottom');
  assert.equal(firstTopIndex < firstTraceIndex && firstTraceIndex < firstReferenceIndex && firstReferenceIndex < firstGuideIndex && firstGuideIndex < firstAlignmentIndex && firstAlignmentIndex < firstBottomIndex, true);
  assert.equal(secondTopIndex < secondTraceIndex && secondTraceIndex < secondReferenceIndex && secondReferenceIndex < secondGuideIndex && secondGuideIndex < secondAlignmentIndex && secondAlignmentIndex < secondBottomIndex, true);
});
test('[EDGE] sequence-viewer ORF translation context terminates before stop codons', () => {
  const sequence = 'ATGAAATAGCCC';
  const feature = sequenceViewerInternals.buildOrfFeatures(sequence, 'linear', { minAaLength: 2 })[0];
  const context = sequenceViewerInternals.buildSelectedOrfTranslationContext(sequence, feature, {
    stopVisibility: { TAG: true }
  });

  assert.equal(Boolean(context), true);
  assert.equal(context.anchors.map((anchor) => anchor.displayText).join('|'), 'M|K');
  assert.equal(context.anchors.some((anchor) => anchor.isStop), false);
  assert.equal(context.anchors.some((anchor) => anchor.codon === 'TAG'), false);
});
test('[EDGE] sequence-viewer dual-strand renderer color-codes amino-acid cells without rendering stop labels', () => {
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
  assert.doesNotMatch(html, /data-aa-display="TAG"/);
  assert.match(html, /data-aa-codon="ATG"/);
  assert.match(html, /data-aa-codon-positions="0,1,2"/);
  assert.match(html, /Right-click to change this amino acid/);
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
  const plainText = stripHtmlTags(html);
  assert.match(plainText, /CGT/);
  assert.match(plainText, /GCA/);
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
  }
};
