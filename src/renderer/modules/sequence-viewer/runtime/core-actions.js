import { escapeHtml } from '../../tool-box/common.js';
import { readStoragePathFromLocalState } from '../storage.js';
import { clamp } from '../shared.js';

export function createSequenceViewerCoreActions({ options, elements, state }) {
  function getBridge() {
    return (typeof options?.getApiBridge === 'function' ? options.getApiBridge() : null)
      || options?.apiBridge
      || options?.bridge
      || globalThis?.window?.hikariApi
      || globalThis?.hikariApi
      || null;
  }

  function getStoragePath() {
    return String(options?.storagePath || '').trim() || readStoragePathFromLocalState();
  }

  function hasStoragePath() {
    return Boolean(getStoragePath());
  }

  function setMode(mode) {
    const resolved = mode === 'file' ? 'file' : 'paste';
    state.mode = resolved;
    elements.modePasteBtn?.classList.toggle('sequence-viewer-mode-btn-active', resolved === 'paste');
    elements.modeFileBtn?.classList.toggle('sequence-viewer-mode-btn-active', resolved === 'file');
    if (elements.pastePanel) {
      elements.pastePanel.hidden = !state.inputComposerVisible || resolved !== 'paste';
    }
    if (elements.filePanel) {
      elements.filePanel.hidden = !state.inputComposerVisible || resolved !== 'file';
    }
  }

  function setInputComposerVisible(visible) {
    const shouldShow = visible !== false;
    state.inputComposerVisible = shouldShow;
    if (elements.modePasteBtn) {
      elements.modePasteBtn.hidden = !shouldShow;
    }
    if (elements.modeFileBtn) {
      elements.modeFileBtn.hidden = !shouldShow;
    }
    if (elements.loadBtn) {
      elements.loadBtn.hidden = !shouldShow;
    }
    if (elements.pastePanel) {
      elements.pastePanel.hidden = !shouldShow || state.mode !== 'paste';
    }
    if (elements.filePanel) {
      elements.filePanel.hidden = !shouldShow || state.mode !== 'file';
    }
  }

  function setStatus(message, isError = false) {
    if (!elements.statusNote) {
      return;
    }
    elements.statusNote.textContent = message;
    elements.statusNote.style.color = isError ? 'var(--danger)' : '';
  }

  function updateMessages() {
    if (!elements.messageBox) {
      return;
    }
    const rows = [
      ...state.errors.map((text) => `<p class="small-note" style="color:var(--danger);">${escapeHtml(text)}</p>`),
      ...state.warnings.map((text) => `<p class="small-note">${escapeHtml(text)}</p>`)
    ];
    elements.messageBox.innerHTML = rows.length
      ? rows.join('')
      : '<p class="small-note">No parser warnings.</p>';
  }

  function getSelectedRecord() {
    const index = clamp(state.selectedRecordIndex, 0, Math.max(0, state.records.length - 1));
    return state.records[index] || null;
  }

  function getDatasetValueFromTarget(target, key) {
    if (!target) {
      return '';
    }
    if (target.dataset && typeof target.dataset[key] === 'string') {
      return target.dataset[key];
    }
    if (typeof target.closest === 'function') {
      const closest = target.closest(`[data-${toDataAttributeName(key)}]`);
      if (closest?.dataset && typeof closest.dataset[key] === 'string') {
        return closest.dataset[key];
      }
    }
    return '';
  }

  async function readFileAsText(file) {
    return new Promise((resolve, reject) => {
      if (!file) {
        reject(new Error('No file selected.'));
        return;
      }
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('Failed to read selected file.'));
      reader.readAsText(file);
    });
  }

  async function readFileAsArrayBuffer(file) {
    if (!file) {
      throw new Error('No file selected.');
    }
    if (typeof file.arrayBuffer === 'function') {
      return await file.arrayBuffer();
    }
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        if (reader.result instanceof ArrayBuffer) {
          resolve(reader.result);
          return;
        }
        reject(new Error('Failed to read selected file as binary data.'));
      };
      reader.onerror = () => reject(new Error('Failed to read selected file as binary data.'));
      reader.readAsArrayBuffer(file);
    });
  }

  return {
    getBridge,
    getStoragePath,
    hasStoragePath,
    setMode,
    setInputComposerVisible,
    setStatus,
    updateMessages,
    getSelectedRecord,
    getDatasetValueFromTarget,
    readFileAsText,
    readFileAsArrayBuffer
  };
}

function toDataAttributeName(key) {
  return String(key || '').replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`);
}
