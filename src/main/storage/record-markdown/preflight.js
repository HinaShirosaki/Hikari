'use strict';

const { prepareRecordDocument } = require('./document-storage');
const { readJsonFile } = require('../storage-utils');

// Detect document conflicts before the full save changes any other record.
async function preflightDocuments(inputs) {
  const destinations = new Map();
  for (const input of inputs) {
    const prior = destinations.get(input.filePath);
    if (prior && JSON.stringify(prior.payload) !== JSON.stringify(input.payload)) throw new Error(`Conflicting records at ${input.filePath}`);
    destinations.set(input.filePath, input);
    try { await prepareRecordDocument(input); }
    catch (error) {
      if (!/user-owned Markdown/.test(error.message) || (await readJsonFile(input.filePath)).data?.document) throw error;
    }
  }
}

module.exports = { preflightDocuments };
