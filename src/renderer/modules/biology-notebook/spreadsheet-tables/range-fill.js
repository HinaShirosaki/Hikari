import { fillCellContent } from '../../../lib/notebook-table-formulas.js';

const DATA_COLUMN_START = 1; // Tabulator includes the row-number gutter.

function selectedBounds(grid) {
  const range = grid.getRanges()[0];
  if (!range || range.getRightEdge() < DATA_COLUMN_START) return null;
  return {
    top: range.getTopEdge(),
    bottom: range.getBottomEdge(),
    left: Math.max(DATA_COLUMN_START, range.getLeftEdge()),
    right: range.getRightEdge()
  };
}

function extensionOf(source, row, column, verticalFirst) {
  const extraRows = row < source.top || row > source.bottom;
  const extraColumns = column < source.left || column > source.right;
  if (extraRows && (verticalFirst || !extraColumns)) {
    return { ...source, top: Math.min(row, source.top), bottom: Math.max(row, source.bottom) };
  }
  if (extraColumns) {
    return { ...source, left: Math.min(column, source.left), right: Math.max(column, source.right) };
  }
  return source;
}

function includes(bounds, row, column) {
  return row >= bounds.top && row <= bounds.bottom && column >= bounds.left && column <= bounds.right;
}

function repeatIndex(index, first, last) {
  const size = last - first + 1;
  return first + ((index - first) % size + size) % size;
}

export function bindNotebookRangeFill({ grid, tableHost, onFill, onSelectTable }) {
  const doc = tableHost.ownerDocument;
  const win = doc.defaultView;
  const holder = tableHost.querySelector('.tabulator-tableholder');
  const handle = doc.createElement('span');
  handle.className = 'notebook-range-fill-handle';
  handle.setAttribute('aria-hidden', 'true');
  let handleFrame = 0;
  let drag = null;
  let preview = new Set();

  function syncHandle() {
    if (handleFrame || drag) return;
    handleFrame = win.requestAnimationFrame(() => {
      handleFrame = 0;
      const bounds = selectedBounds(grid);
      const row = bounds && grid.getRowFromPosition(bounds.bottom + 1);
      const columns = grid.getColumns();
      const hasRoom = bounds && (bounds.top > 0 || bounds.left > DATA_COLUMN_START
        || bounds.bottom < grid.getDataCount() - 1 || bounds.right < columns.length - 1);
      const cell = row && hasRoom
        && row.getElement().isConnected
        && row.getCell(columns[bounds.right]?.getField())?.getElement();
      if (!cell || cell.classList.contains('tabulator-editing')) {
        handle.remove();
      } else if (cell !== handle.parentElement) {
        cell.appendChild(handle);
      }
    });
  }

  function setPreview(next = new Set()) {
    preview.forEach((cell) => {
      if (!next.has(cell)) cell.classList.remove('is-fill-target');
    });
    next.forEach((cell) => {
      if (!preview.has(cell)) cell.classList.add('is-fill-target');
    });
    preview = next;
  }

  function updateTarget() {
    const { source, columns, x, y, startX, startY } = drag;
    const holderRect = holder.getBoundingClientRect();
    const bottom = holderRect.top + holder.clientHeight;
    const right = holderRect.left + holder.clientWidth;
    const rows = grid.getRows('visible');
    // Tabulator renders only a window of long tables. Resolve the destination
    // against visible rows so detached cells never register as being at (0, 0).
    let row = (rows[0]?.getPosition() ?? source.bottom + 1) - 1;
    for (const item of rows) {
      if (Math.min(y, bottom - 1) < item.getElement().getBoundingClientRect().top) break;
      row = item.getPosition() - 1;
    }
    const gutterRight = columns[0].getElement().getBoundingClientRect().right;
    let column;
    for (let i = DATA_COLUMN_START; i < columns.length; i += 1) {
      const rect = columns[i].getElement().getBoundingClientRect();
      if (rect.left >= right) break;
      if (rect.right <= gutterRight) continue;
      if (x < rect.left && column !== undefined) break;
      column = i;
    }
    const verticalFirst = Math.abs(y - startY) >= Math.abs(x - startX);
    drag.destination = extensionOf(source, row, column ?? source.right, verticalFirst);
    const next = new Set();
    if (drag.destination !== source) {
      for (const item of rows) {
        const index = item.getPosition() - 1;
        for (let i = drag.destination.left; i <= drag.destination.right; i += 1) {
          if (includes(drag.destination, index, i) && !includes(source, index, i)) {
            const cell = item.getCell(columns[i].getField())?.getElement();
            if (cell) next.add(cell);
          }
        }
      }
    }
    setPreview(next);
    return drag.destination === source ? verticalFirst
      : drag.destination.top !== source.top || drag.destination.bottom !== source.bottom;
  }

  function updateDrag() {
    drag.frame = 0;
    const vertical = updateTarget();
    const rect = holder.getBoundingClientRect();
    const direction = (position, minimum, maximum) => (
      position < minimum + 16 ? -12 : position > maximum - 16 ? 12 : 0
    );
    const before = vertical ? holder.scrollTop : holder.scrollLeft;
    if (vertical) {
      if (drag.y !== drag.startY) holder.scrollTop += direction(drag.y, rect.top, rect.top + holder.clientHeight);
    } else if (drag.x !== drag.startX) {
      const gutter = drag.columns[0].getWidth();
      holder.scrollLeft += direction(drag.x, rect.left + gutter, rect.left + holder.clientWidth);
    }
    if (before !== (vertical ? holder.scrollTop : holder.scrollLeft)) {
      drag.frame = win.requestAnimationFrame(updateDrag);
    }
  }

  function onMove(event) {
    drag.x = event.clientX;
    drag.y = event.clientY;
    if (!drag.frame) drag.frame = win.requestAnimationFrame(updateDrag);
  }

  function cancel() {
    if (!drag) return;
    win.cancelAnimationFrame(drag.frame);
    drag.listeners.abort();
    drag = null;
    setPreview();
    syncHandle();
  }

  function finish(event) {
    if (event.button !== 0) return;
    drag.x = event.clientX;
    drag.y = event.clientY;
    const { source, columns, rows, startX, startY } = drag;
    if (drag.x !== startX || drag.y !== startY) updateTarget();
    const { destination } = drag;
    cancel();
    if (source === destination) return;

    const patches = new Map();
    const values = rows.map((row) => row.getData());
    for (let row = destination.top; row <= destination.bottom; row += 1) {
      for (let column = destination.left; column <= destination.right; column += 1) {
        if (includes(source, row, column)) continue;
        const sourceRow = repeatIndex(row, source.top, source.bottom);
        const sourceColumn = repeatIndex(column, source.left, source.right);
        const field = columns[column].getField();
        const value = fillCellContent(values[sourceRow][columns[sourceColumn].getField()],
          column - sourceColumn, row - sourceRow);
        if (value === String(values[row][field] ?? '')) continue;
        if (!patches.has(row)) patches.set(row, {});
        patches.get(row)[field] = value;
      }
    }
    if (!patches.size) return;
    // Update each affected row once, then let Notebook recalculate all its tables.
    patches.forEach((values, index) => rows[index].update(values));
    onFill();
    const first = rows[destination.top].getCell(columns[destination.left].getField());
    const last = rows[destination.bottom].getCell(columns[destination.right].getField());
    grid.getRanges()[0]?.setBounds(first, last);
  }

  function start(event) {
    if (drag || event.button !== 0 || event.target !== handle) return;
    const source = selectedBounds(grid);
    if (!source) return;
    event.preventDefault();
    event.stopPropagation();
    const input = tableHost.querySelector('.tabulator-editing input');
    input?.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
    const { clientX: x, clientY: y } = event;
    const listeners = new win.AbortController();
    const options = { capture: true, signal: listeners.signal };
    drag = { source, destination: source, columns: grid.getColumns(), rows: grid.getRows(),
      startX: x, startY: y, x, y, frame: 0, listeners };
    doc.addEventListener('mousemove', onMove, options);
    doc.addEventListener('mouseup', finish, options);
    doc.addEventListener('keydown', (keyEvent) => {
      if (keyEvent.key === 'Escape') cancel();
    }, options);
    win.addEventListener('blur', cancel, options);
    onSelectTable();
  }

  tableHost.addEventListener('mousedown', start, true);
  grid.on('cellMouseDown', onSelectTable);
  const redrawEvents = ['rangeAdded', 'rangeChanged', 'renderComplete', 'scrollVertical', 'cellEditCancelled'];
  redrawEvents.forEach((event) => grid.on(event, syncHandle));
  syncHandle();
  return {
    syncHandle,
    destroy() {
      cancel();
      win.cancelAnimationFrame(handleFrame);
      tableHost.removeEventListener('mousedown', start, true);
      grid.off('cellMouseDown', onSelectTable);
      redrawEvents.forEach((event) => grid.off(event, syncHandle));
      handle.remove();
    }
  };
}
