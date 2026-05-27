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
test('[EDGE] sequence-viewer buildCircularPreviewHtmlDocument emits standalone DNAfeatureviewer-style circular HTML', () => {
  const html = sequenceViewerInternals.buildCircularPreviewHtmlDocument({
    name: 'pPreview',
    topology: 'circular',
    sequence: 'A'.repeat(3200),
    features: [
      {
        name: 'AmpR',
        type: 'cds',
        strand: 1,
        segments: [{ start: 140, end: 980 }]
      },
      {
        name: 'pUC origin',
        type: 'rep_origin',
        strand: 0,
        segments: [{ start: 2100, end: 2780 }]
      },
      {
        name: 'MCS insert',
        type: 'misc_feature',
        strand: -1,
        segments: [{ start: 1080, end: 1355 }]
      }
    ]
  });

  assert.match(html, /data-renderer="dna-feature-viewer-js"/);
  assert.match(html, /Circular plasmid preview/i);
  assert.match(html, /AmpR/);
  assert.match(html, /pUC origin/);
  assert.match(html, /circular-preview__leader/);
  assert.match(html, /circular-preview__scene/);
  assert.match(html, /circular-preview__hover-tooltip/);
  assert.match(html, /background:\s*rgba\(255,\s*252,\s*247,\s*0\.98\)/i);
  assert.match(html, /border:\s*1px solid rgba\(216,\s*206,\s*193,\s*0\.96\)/i);
  assert.match(html, /data-preview-tooltip="feature"/);
  assert.match(html, /data-tooltip-description="/);
  assert.match(html, /data-feature-x="/);
  assert.match(html, /data-feature-index="1"/);
  assert.match(html, /\.preview-shell\s*\{[\s\S]*height:\s*100%/i);
  assert.match(html, /svg\s*\{[\s\S]*width:\s*100%/i);
  assert.match(html, /svg\s*\{[\s\S]*height:\s*100%/i);
  assert.match(html, /preserveAspectRatio="xMidYMid meet"/i);
  assert.match(html, /getBBox\(\)/);
  assert.match(html, /pointerenter/);
  assert.match(html, /background:\s*#ffffff/i);
  assert.doesNotMatch(html, /radial-gradient/i);
  assert.doesNotMatch(html, /\.preview-shell\s*\{[^}]*box-shadow:/i);
  assert.doesNotMatch(html, /svg\s*\{[^}]*width:\s*auto/i);
});
test('[EDGE] sequence-viewer buildCircularPreviewHtmlDocument balances crowded top labels across both sides', () => {
  const html = sequenceViewerInternals.buildCircularPreviewHtmlDocument({
    name: 'pCrowded',
    topology: 'circular',
    sequence: 'A'.repeat(4000),
    features: [0, 80, 160, 240, 320, 400].map((start, index) => ({
      name: `misc_feature_${index + 1}`,
      type: 'misc_feature',
      strand: 0,
      segments: [{ start, end: start + 60 }]
    }))
  });

  assert.match(html, /data-label-side="left"/);
  assert.match(html, /data-label-side="right"/);
  const viewBoxMatch = html.match(/viewBox="0 0 (\d+(?:\.\d+)?) (\d+(?:\.\d+)?)"/i);
  assert.ok(viewBoxMatch);
  assert.equal(Number(viewBoxMatch[1]) > Number(viewBoxMatch[2]), true);
});
test('[EDGE] sequence-viewer buildCircularPreviewHtmlDocument returns an empty-state HTML shell without sequence', () => {
  const html = sequenceViewerInternals.buildCircularPreviewHtmlDocument({
    name: 'empty_preview',
    sequence: '',
    features: []
  });

  assert.match(html, /data-renderer="dna-feature-viewer-js"/);
  assert.match(html, /No sequence is available/i);
  assert.doesNotMatch(html, /<svg/i);
});
  }
};