module.exports = function registerEdgeToolBoxSuitePart03(context = {}) {
  const scope = context.scope || {};
  const __dirname = context.__dirname || process.cwd();
  with (scope) {
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
  }
};