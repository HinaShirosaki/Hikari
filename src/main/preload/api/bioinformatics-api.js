'use strict';

const { BIOINFORMATICS } = require('../../../shared/ipc/channels');

function createBioinformaticsApi(ipcRenderer) {
  return {
    submitBlast: (payload = {}) => ipcRenderer.invoke(BIOINFORMATICS.BLAST_SUBMIT, payload),
    getBlastStatus: (rid) => ipcRenderer.invoke(
      BIOINFORMATICS.BLAST_STATUS,
      typeof rid === 'object' && rid !== null ? rid : { rid }
    ),
    getBlastResults: (payload = {}) => ipcRenderer.invoke(BIOINFORMATICS.BLAST_RESULTS, payload),
    searchUniProt: (payload = {}) => ipcRenderer.invoke(BIOINFORMATICS.UNIPROT_SEARCH, payload),
    getUniProtEntry: (accession) => ipcRenderer.invoke(
      BIOINFORMATICS.UNIPROT_GET,
      typeof accession === 'object' && accession !== null ? accession : { accession }
    )
  };
}

module.exports = {
  createBioinformaticsApi
};
