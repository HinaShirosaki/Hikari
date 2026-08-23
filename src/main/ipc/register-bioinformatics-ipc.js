'use strict';

const { BIOINFORMATICS } = require('../../shared/ipc/channels');
const { ensureObject } = require('../lib/normalize.js');

function registerBioinformaticsIpc({ ipcMain, bioinformaticsService, cleanText } = {}) {
  const clean = typeof cleanText === 'function'
    ? cleanText
    : ((value, maxLength = 2400) => String(value || '').trim().slice(0, maxLength));

  function failure(error, fallbackMessage) {
    const result = {
      ok: false,
      error: clean(error?.message || error, 2400) || fallbackMessage,
      code: clean(error?.code, 120) || 'BIOINFORMATICS_ERROR'
    };
    if (error?.status !== null
      && error?.status !== undefined
      && Number.isFinite(Number(error.status))) {
      result.status = Number(error.status);
    }
    if (error?.retryAfterMs !== null
      && error?.retryAfterMs !== undefined
      && Number.isFinite(Number(error.retryAfterMs))) {
      result.retry_after_ms = Math.max(0, Number(error.retryAfterMs));
    }
    return result;
  }

  function handle(channel, methodName, resultKey, fallbackMessage) {
    ipcMain.handle(channel, async (_event, payload) => {
      try {
        const value = await bioinformaticsService[methodName](ensureObject(payload));
        return { ok: true, [resultKey]: value };
      } catch (error) {
        return failure(error, fallbackMessage);
      }
    });
  }

  handle(BIOINFORMATICS.BLAST_SUBMIT, 'submitBlast', 'job', 'Failed to submit the BLAST search.');
  handle(BIOINFORMATICS.BLAST_STATUS, 'getBlastStatus', 'status', 'Failed to check the BLAST search.');
  handle(BIOINFORMATICS.BLAST_RESULTS, 'getBlastResults', 'result', 'Failed to retrieve BLAST results.');
  handle(BIOINFORMATICS.UNIPROT_SEARCH, 'searchUniProt', 'result', 'Failed to search UniProt.');
  handle(BIOINFORMATICS.UNIPROT_GET, 'getUniProtEntry', 'result', 'Failed to retrieve the UniProt entry.');
}

module.exports = {
  registerBioinformaticsIpc
};
