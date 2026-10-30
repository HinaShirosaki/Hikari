export function createNotebookToolRowManagers({
  addListener,
  bufferRows,
  bufferRowTemplate,
  closeBufferSuggestions,
  doc,
  getElement,
  initialBufferRowCount,
  initialReactionRowCount,
  reactionRowTemplate,
  renderBufferSuggestions,
  renderCurrentTool,
  selectBufferCandidate,
  syncBufferCompound
} = {}) {
  let bufferRowTotal = initialBufferRowCount;
  let reactionRowTotal = initialReactionRowCount;

  function bufferRowCount() {
    return bufferRowTotal;
  }

  function reactionRowCount() {
    return reactionRowTotal;
  }

  function bindReactionRow(index) {
      [
        `biology-notebook-tool-reaction-name-${index}`,
        `biology-notebook-tool-reaction-stock-${index}`,
        `biology-notebook-tool-reaction-final-${index}`,
        `biology-notebook-tool-reaction-volume-${index}`,
        `biology-notebook-tool-reaction-note-${index}`
      ].forEach((id) => {
        const element = getElement(doc, id);
        addListener(element, 'input', renderCurrentTool);
        addListener(element, 'change', renderCurrentTool);
      });
    }
  
    function appendReactionRow() {
      const addRow = getElement(doc, 'biology-notebook-tool-reaction-add-row-anchor');
      const rowsHost = addRow?.parentElement;
      if (!reactionRowTemplate?.cloneNode || typeof rowsHost?.insertBefore !== 'function') {
        return;
      }
      const index = reactionRowTotal + 1;
      const row = reactionRowTemplate.cloneNode(true);
      row.hidden = false;
      row.id = `biology-notebook-tool-reaction-row-${index}`;
      row.querySelectorAll?.('[id]').forEach((element) => {
        element.id = `${element.id.replace(/-\d+$/, '')}-${index}`;
        element.value = '';
        element.textContent = '';
        const label = element.getAttribute?.('aria-label');
        if (label) {
          element.setAttribute('aria-label', label.replace(/\d+/, String(index)));
        }
      });
      rowsHost.insertBefore(row, addRow);
      reactionRowTotal = index;
      bindReactionRow(index);
    }
  
    function revealOrAddReactionRow() {
      for (let index = 1; index <= reactionRowCount(); index += 1) {
        const row = getElement(doc, `biology-notebook-tool-reaction-row-${index}`);
        if (row?.hidden) {
          row.hidden = false;
          renderCurrentTool();
          return;
        }
      }
      appendReactionRow();
      renderCurrentTool();
    }
  
    function insertBufferRowBeforeAddRow(row) {
      const addRow = getElement(doc, 'biology-notebook-tool-buffer-add-row-anchor');
      if (
        addRow?.parentElement === bufferRows
        && typeof bufferRows?.insertBefore === 'function'
      ) {
        bufferRows.insertBefore(row, addRow);
        return true;
      }
      if (typeof bufferRows?.appendChild === 'function') {
        bufferRows.appendChild(row);
        return true;
      }
      return false;
    }
  
    function bindBufferRow(index) {
      const nameInput = getElement(doc, `biology-notebook-tool-buffer-name-${index}`);
      const suggestions = getElement(doc, `biology-notebook-tool-buffer-suggestions-${index}`);
      addListener(nameInput, 'focus', () => renderBufferSuggestions(index));
      addListener(nameInput, 'input', () => {
        syncBufferCompound(index, { overwriteMw: true });
        renderBufferSuggestions(index);
        renderCurrentTool();
      });
      addListener(nameInput, 'keydown', (event) => {
        if (event?.key === 'Escape') {
          closeBufferSuggestions(index);
        }
      });
      addListener(suggestions, 'mousedown', (event) => {
        event?.preventDefault?.();
      });
      addListener(suggestions, 'click', (event) => {
        const button = event?.target?.closest?.('[data-buffer-candidate]')
          || (event?.target?.dataset?.bufferCandidate ? event.target : null);
        const candidateName = button?.dataset?.bufferCandidate || '';
        if (candidateName) {
          selectBufferCandidate(index, candidateName);
        }
      });
      [
        `biology-notebook-tool-buffer-mw-${index}`,
        `biology-notebook-tool-buffer-stock-${index}`,
        `biology-notebook-tool-buffer-final-${index}`,
        `biology-notebook-tool-buffer-amount-${index}`,
        `biology-notebook-tool-buffer-note-${index}`
      ].forEach((id) => {
        const element = getElement(doc, id);
        addListener(element, 'input', renderCurrentTool);
        addListener(element, 'change', renderCurrentTool);
      });
    }
  
    function appendBufferRow() {
      if (!bufferRowTemplate?.cloneNode) {
        return;
      }
      const index = bufferRowCount() + 1;
      const row = bufferRowTemplate.cloneNode(true);
      row.hidden = false;
      row.id = `biology-notebook-tool-buffer-row-${index}`;
      row.querySelectorAll?.('[id]').forEach((element) => {
        element.id = `${element.id.replace(/-\d+$/, '')}-${index}`;
        element.value = '';
        element.textContent = '';
        const label = element.getAttribute?.('aria-label');
        if (label) {
          element.setAttribute('aria-label', label.replace(/\d+/, String(index)));
        }
        const controls = element.getAttribute?.('aria-controls');
        if (controls) {
          element.setAttribute('aria-controls', controls.replace(/-\d+$/, `-${index}`));
        }
        if (element.dataset?.bufferChemicalIndex) {
          element.dataset.bufferChemicalIndex = String(index);
        }
      });
      const menu = row.querySelector?.('.biology-notebook-buffer-suggestions');
      if (menu) {
        menu.hidden = true;
        menu.innerHTML = '';
      }
      if (!insertBufferRowBeforeAddRow(row)) {
        return;
      }
      bufferRowTotal = index;
      bindBufferRow(index);
    }
  
    function revealOrAddBufferRow() {
      for (let index = 1; index <= bufferRowCount(); index += 1) {
        const row = getElement(doc, `biology-notebook-tool-buffer-row-${index}`);
        if (row?.hidden) {
          row.hidden = false;
          renderCurrentTool();
          return;
        }
      }
      appendBufferRow();
      renderCurrentTool();
    }

  return {
    appendBufferRow,
    appendReactionRow,
    bindBufferRow,
    bindReactionRow,
    bufferRowCount,
    reactionRowCount,
    revealOrAddBufferRow,
    revealOrAddReactionRow
  };
}
