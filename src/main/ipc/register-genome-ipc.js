'use strict';

const { GENOME } = require('../../shared/ipc/channels');
const { ensureObject } = require('../lib/normalize.js');

// Note there is deliberately no channel that takes a filesystem path. ADD opens the picker in the
// main process and every read is addressed by registered genome id, so the renderer cannot use this
// bridge to read files the user never chose.
function registerGenomeIpc({ ipcMain, genomeService, cleanText } = {}) {
  const clean = typeof cleanText === 'function'
    ? cleanText
    : ((value, maxLength = 2400) => String(value || '').trim().slice(0, maxLength));

  function failure(error, fallbackMessage) {
    return {
      ok: false,
      error: clean(error?.message || error, 2400) || fallbackMessage
    };
  }

  ipcMain.handle(GENOME.LIST, async () => {
    try {
      return { ok: true, genomes: await genomeService.listGenomes() };
    } catch (error) {
      return { ...failure(error, 'Failed to list connected genomes.'), genomes: [] };
    }
  });

  ipcMain.handle(GENOME.GET, async (_event, payload) => {
    try {
      const genome = await genomeService.getGenome(ensureObject(payload));
      return genome
        ? { ok: true, genome }
        : { ok: false, not_found: true, error: 'That genome is not connected.' };
    } catch (error) {
      return failure(error, 'Failed to read genome details.');
    }
  });

  ipcMain.handle(GENOME.ADD, async (_event, payload) => {
    try {
      const result = await genomeService.addGenome(ensureObject(payload));
      return result?.canceled
        ? { ok: false, canceled: true }
        : { ok: true, genome: result.genome };
    } catch (error) {
      return failure(error, 'Failed to connect that genome file.');
    }
  });

  ipcMain.handle(GENOME.REMOVE, async (_event, payload) => {
    try {
      const result = await genomeService.removeGenome(ensureObject(payload));
      return { ok: result.removed === true, removed: result.removed === true };
    } catch (error) {
      return failure(error, 'Failed to disconnect that genome.');
    }
  });

  ipcMain.handle(GENOME.READ_REGION, async (_event, payload) => {
    try {
      return { ok: true, region: await genomeService.readRegion(ensureObject(payload)) };
    } catch (error) {
      return failure(error, 'Failed to read that genome region.');
    }
  });
}

module.exports = {
  registerGenomeIpc
};
