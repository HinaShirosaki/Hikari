module.exports = function registerEdgeToolBoxExposureSuite(context = {}) {
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
    'assembleCloningPlan',
    'evaluateOverlapPcr',
    'evaluateGibsonAssembly',
    'evaluateRestrictionLigation',
    'evaluateSiteDirectedMutagenesis',
    'designCloningPrimers',
    'linearRegression',
    'peptideStats',
    'renderChemicalOptions',
    'parseCrisprTargetsInput',
    'designCrisprGuides'
  ].forEach((name) => {
    assert.equal(typeof toolBox[name], 'function');
  });
});

  }
};
