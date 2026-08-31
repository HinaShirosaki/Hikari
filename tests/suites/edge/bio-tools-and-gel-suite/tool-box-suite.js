module.exports = function registerEdgeToolBoxSuite(context = {}) {
  const registerParts = [
    require('./tool-box-suite/codon-optimization-and-cloning-evaluation.js'),
    require('./tool-box-suite/primer-design-and-crispr-guides.js'),
    require('./tool-box-suite/crispr-gc-filtering.js')
  ];

  registerParts.forEach((registerPart) => registerPart(context));
};
