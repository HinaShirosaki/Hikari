// Settings > Genomes panel: connect local reference genome FASTA files and disconnect them again.
//
// The registry itself lives in the main process (src/main/core/services/create-genome-service.js).
// Nothing here ever handles a filesystem path: addGenome opens the native picker in main, and the
// renderer only ever holds genome ids.
import { showTransientNotice } from '../../lib/notify.js';

export function createGenomesController({
  api,
  statusElement,
  listElement,
  escapeHtml
}) {
  let genomes = [];
  let statusMessage = '';
  let busy = false;

  function setStatus(message, isError = false) {
    if (isError && message) {
      showTransientNotice(String(message), { type: 'error' });
    }
    statusMessage = String(message || '');
    render();
  }

  function formatBases(total) {
    const bases = Number(total) || 0;
    if (bases >= 1e9) {
      return `${(bases / 1e9).toFixed(2)} Gb`;
    }
    if (bases >= 1e6) {
      return `${(bases / 1e6).toFixed(2)} Mb`;
    }
    if (bases >= 1e3) {
      return `${(bases / 1e3).toFixed(1)} kb`;
    }
    return `${bases.toLocaleString()} bp`;
  }

  async function refresh() {
    if (!api?.listGenomes) {
      genomes = [];
      setStatus('Genome connections are unavailable in this environment.', true);
      return;
    }
    const response = await api.listGenomes();
    genomes = Array.isArray(response?.genomes) ? response.genomes : [];
    render();
  }

  async function onAddGenome() {
    if (!api?.addGenome) {
      setStatus('Genome connections are unavailable in this environment.', true);
      return;
    }
    if (busy) {
      return;
    }
    busy = true;
    // Indexing streams the whole file, so a multi-gigabyte assembly takes a while.
    setStatus('Indexing genome file...');
    try {
      const response = await api.addGenome({});
      if (response?.canceled) {
        setStatus('');
        return;
      }
      if (response?.ok !== true) {
        setStatus(response?.error || 'Failed to connect that genome file.', true);
        return;
      }
      await refresh();
      setStatus(`Connected "${response.genome?.label || 'genome'}".`);
    } finally {
      busy = false;
    }
  }

  async function onRemoveGenome(id) {
    if (!api?.removeGenome) {
      return;
    }
    const response = await api.removeGenome(id);
    if (response?.ok !== true) {
      setStatus(response?.error || 'Failed to disconnect that genome.', true);
      return;
    }
    await refresh();
    setStatus('Disconnected. The genome file itself was left untouched.');
  }

  function render() {
    if (statusElement) {
      statusElement.textContent = statusMessage;
    }
    if (!listElement) {
      return;
    }
    if (!genomes.length) {
      listElement.innerHTML = '<p class="small-note">No genomes connected. Add a FASTA file to make it available to sequence tools.</p>';
      return;
    }
    listElement.innerHTML = genomes.map((genome) => {
      const missing = genome.missing === true
        ? '<span class="small-note">File is missing — it may have moved or its drive is not mounted.</span>'
        : '';
      return `
        <div class="settings-skill-row">
          <div>
            <p><strong>${escapeHtml(genome.label)}</strong></p>
            <p class="small-note">${escapeHtml(genome.filePath)}</p>
            <p class="small-note">${genome.recordCount.toLocaleString()} sequences | ${formatBases(genome.totalLength)}</p>
            ${missing}
          </div>
          <button type="button" class="ghost-btn" data-genome-remove="${escapeHtml(genome.id)}">Disconnect</button>
        </div>
      `;
    }).join('');
  }

  listElement?.addEventListener('click', (event) => {
    const id = event.target?.dataset?.genomeRemove;
    if (id) {
      void onRemoveGenome(id);
    }
  });

  return { refresh, onAddGenome, render };
}
