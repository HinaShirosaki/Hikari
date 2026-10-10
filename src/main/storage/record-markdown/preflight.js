'use strict';

// Ambiguous destinations are rejected before the save writes anything. A
// damaged or conflicting document is handled by the writer, which skips only
// that record.
function preflightDocuments(inputs) {
  const destinations = new Map();
  for (const input of inputs) {
    const prior = destinations.get(input.filePath);
    if (prior && JSON.stringify(prior.payload) !== JSON.stringify(input.payload)) throw new Error(`Conflicting records at ${input.filePath}`);
    destinations.set(input.filePath, input);
  }
}

module.exports = { preflightDocuments };
