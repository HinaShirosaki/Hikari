module.exports = function registerEdgeSequenceViewerFoundationsSuitePart03(context = {}) {
  const scope = context.scope || {};
  const __dirname = context.__dirname || process.cwd();
  with (scope) {
function stripHtmlTags(html) {
  return String(html || '').replace(/<[^>]*>/g, '');
}
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
test('[EDGE] sequence-viewer feature detail formatter calculates CDS protein properties from translation qualifiers', () => {
  const html = sequenceViewerInternals.formatSelectedFeatureDetailHtml({
    name: 'tiny_cds',
    type: 'cds',
    strand: 1,
    translation: 'M*',
    segments: [{ start: 0, end: 6 }]
  }, 6);

  assert.match(html, /<strong>Protein:<\/strong>/);
  assert.match(html, /1 aa/);
  assert.match(html, /Monoisotopic MW 149\.05 Da/);
  assert.match(html, /pI \d+\.\d{2}/);
  assert.match(html, /from translation/);
});
test('[EDGE] sequence-viewer feature detail formatter derives CDS protein properties from DNA when translation is absent', () => {
  const html = sequenceViewerInternals.formatSelectedFeatureDetailHtml({
    name: 'derived_cds',
    type: 'cds',
    strand: 1,
    segments: [{ start: 0, end: 9 }]
  }, 9, {
    sequence: 'ATGAAATAA'
  });

  assert.match(html, /<strong>Protein:<\/strong>/);
  assert.match(html, /2 aa/);
  assert.match(html, /Monoisotopic MW 277\.15 Da/);
  assert.match(html, /derived from CDS DNA/);
});
const MAP_FEATURES = [
  { name: 'AmpR', type: 'cds', strand: 1, segments: [{ start: 140, end: 980 }] },
  { name: 'pUC origin', type: 'rep_origin', strand: 0, segments: [{ start: 2100, end: 2780 }] },
  { name: 'MCS insert', type: 'misc_feature', strand: -1, segments: [{ start: 1080, end: 1355 }] }
];

test('[EDGE] sequence-viewer buildSequenceMapSvg draws circular records as an inline plasmid ring', () => {
  const svg = sequenceViewerInternals.buildSequenceMapSvg(
    { name: 'pPreview', topology: 'circular', sequence: 'A'.repeat(3200) },
    { features: MAP_FEATURES }
  );

  // Inline SVG, not a standalone HTML document: no <html>/<style>, so the map
  // inherits app theming instead of shipping its own hardcoded palette.
  assert.doesNotMatch(svg, /<html/i);
  assert.doesNotMatch(svg, /<style/i);
  assert.match(svg, /<circle class="vector-map__backbone"/);
  assert.match(svg, /data-map-kind="circular"/);
  assert.match(svg, /AmpR/);
  assert.match(svg, /pUC origin/);
  assert.match(svg, /data-feature-index="2"/);
  assert.match(svg, /preserveAspectRatio="xMidYMid meet"/);
  assert.equal(/NaN/.test(svg), false);
});

test('[EDGE] sequence-viewer buildSequenceMapSvg draws non-circular records as a linear track', () => {
  const svg = sequenceViewerInternals.buildSequenceMapSvg(
    { name: 'linFragment', topology: 'linear', sequence: 'A'.repeat(3200) },
    { features: MAP_FEATURES }
  );

  assert.match(svg, /data-map-kind="linear"/);
  assert.match(svg, /<line class="vector-map__backbone"/);
  // A linear construct must not be drawn as a closed ring.
  assert.doesNotMatch(svg, /<circle class="vector-map__backbone"/);
  assert.match(svg, /bp linear/);
  assert.match(svg, /AmpR/);
  assert.match(svg, /data-feature-index="0"/);
  assert.equal(/NaN/.test(svg), false);
});

test('[EDGE] sequence-viewer linear map keeps crowded names readable and off intron gaps', () => {
  const svg = sequenceViewerInternals.buildSequenceMapSvg(
    { name: 'crowded', topology: 'linear', sequence: 'A'.repeat(2400) },
    {
      features: [
        { name: 'T7 promoter', type: 'promoter', strand: 1, segments: [{ start: 20, end: 80 }] },
        { name: 'His6', type: 'cds', strand: 1, segments: [{ start: 100, end: 118 }] },
        { name: 'EGFP', type: 'cds', strand: 1, segments: [{ start: 130, end: 850 }] },
        { name: 'spliced ORF', type: 'cds', strand: 1, segments: [{ start: 1800, end: 1900 }, { start: 2000, end: 2150 }] }
      ]
    }
  );

  const labels = [...svg.matchAll(/class="vector-map__label-text( vector-map__label-text--on-bar)?"\s*\n?\s*x="(-?[\d.]+)"\s*\n?\s*y="(-?[\d.]+)"[\s\S]*?>([^<]+)</g)]
    .map((match) => ({ onBar: Boolean(match[1]), x: Number(match[2]), y: Number(match[3]), name: match[4] }));
  assert.equal(labels.length, 4);

  const byName = Object.fromEntries(labels.map((label) => [label.name, label]));
  // T7 promoter and His6 are adjacent and narrow; they must not share a row.
  assert.notEqual(byName['T7 promoter'].y, byName.His6.y);
  // A wide feature still gets its name printed on the bar.
  assert.equal(byName.EGFP.onBar, true);
  // The spliced feature's widest segment cannot hold the name, so it must move
  // above the bar rather than print white text into the intron gap.
  assert.equal(byName['spliced ORF'].onBar, false);
});

test('[EDGE] sequence-viewer sequence map treats missing topology as linear', () => {
  const record = { name: 'noTopology', sequence: 'ACGTACGTAC' };
  assert.equal(sequenceViewerInternals.getMapKind(record), 'linear');
  assert.equal(sequenceViewerInternals.getMapKind({ ...record, topology: 'circular' }), 'circular');
  assert.match(sequenceViewerInternals.buildSequenceMapSvg(record, { features: [] }), /data-map-kind="linear"/);
});

test('[EDGE] sequence-viewer circular map balances crowded labels across both sides', () => {
  const svg = sequenceViewerInternals.buildSequenceMapSvg(
    { name: 'pCrowded', topology: 'circular', sequence: 'A'.repeat(4000) },
    {
      features: [0, 80, 160, 240, 320, 400].map((start, index) => ({
        name: `misc_feature_${index + 1}`,
        type: 'misc_feature',
        strand: 0,
        segments: [{ start, end: start + 60 }]
      }))
    }
  );

  const labelYs = [...svg.matchAll(/class="vector-map__label-text"[^>]*y="(-?\d+(?:\.\d+)?)"/g)]
    .map((match) => Number(match[1]));
  assert.equal(labelYs.length, 6);
  // Every stacked callout keeps a readable gap; none collapse onto each other.
  const sorted = [...labelYs].sort((left, right) => left - right);
  sorted.slice(1).forEach((value, index) => {
    assert.equal(value - sorted[index] >= 16, true);
  });
});

test('[EDGE] sequence-viewer map feature arcs carry the hover readout label', () => {
  const svg = sequenceViewerInternals.buildSequenceMapSvg(
    { name: 'pPrimers', topology: 'circular', sequence: 'A'.repeat(5000) },
    {
      features: [
        { name: 'AmpR', type: 'cds', strand: 1, segments: [{ start: 200, end: 1060 }] },
        { name: 'M13 fwd', type: 'primer_bind', strand: 1, segments: [{ start: 2300, end: 2322 }] }
      ]
    }
  );

  // The hover readout reads aria-label off whatever the pointer is over, so a
  // short primer arc has to carry its own name even though the arc is a sliver.
  assert.match(svg, /aria-label="M13 fwd \(2301\.\.2322\)"/);
  assert.match(svg, /aria-label="AmpR \(201\.\.1060\)"/);
  // No <title> children: those render a slow, unstyleable native tooltip that
  // would double up with the hover readout.
  assert.equal(/<title>/.test(svg), false);
});

test('[EDGE] sequence-viewer map zoom clamps to the fit-to-pane range', () => {
  // 1 means "fits the pane", so there is nothing meaningful below it.
  assert.equal(sequenceViewerInternals.clampMapZoom(0.2), 1);
  assert.equal(sequenceViewerInternals.clampMapZoom(1), 1);
  assert.equal(sequenceViewerInternals.clampMapZoom(3.5), 3.5);
  assert.equal(sequenceViewerInternals.clampMapZoom(9999), 12);
  assert.equal(sequenceViewerInternals.clampMapZoom(Number.NaN), 1);
  assert.equal(sequenceViewerInternals.clampMapZoom(undefined), 1);
});

test('[EDGE] sequence-viewer sequence map renders an empty-state note without an SVG', () => {
  const markup = sequenceViewerInternals.buildSequenceMapSvg({ name: 'empty_preview', sequence: '' }, { features: [] });
  assert.match(markup, /No sequence available to map/i);
  assert.doesNotMatch(markup, /<svg/i);
});

test('[EDGE] sequence-viewer resolveBaseFromPoint inverts pointer positions for both map kinds', () => {
  const length = 4000;
  const rect = { left: 0, top: 0, width: 900, height: 900 };
  // Circular: 12 o'clock is base 0, a quarter turn clockwise is a quarter of
  // the plasmid.
  const centre = 450;
  assert.equal(sequenceViewerInternals.resolveBaseFromPoint(rect, centre, 100, length, 'circular'), 0);
  assert.equal(sequenceViewerInternals.resolveBaseFromPoint(rect, 800, centre, length, 'circular'), length / 4);
  assert.equal(sequenceViewerInternals.resolveBaseFromPoint(rect, centre, 800, length, 'circular'), length / 2);

  // Linear: the 1200x360 viewBox letterboxes inside a square rect.
  const scale = Math.min(900 / 1200, 900 / 360);
  const originX = (900 - (1200 * scale)) / 2;
  const atBase = (base) => originX + ((90 + ((base / length) * 1020)) * scale);
  assert.equal(sequenceViewerInternals.resolveBaseFromPoint(rect, atBase(0), 450, length, 'linear'), 0);
  assert.equal(sequenceViewerInternals.resolveBaseFromPoint(rect, atBase(1000), 450, length, 'linear'), 1000);
  assert.equal(sequenceViewerInternals.resolveBaseFromPoint(rect, atBase(length), 450, length, 'linear'), length);
});
  }
};
