import { toRowLabel, wellIdFor } from '../plate-model.js';
import { oppositeAxis } from '../shared.js';

// Pure builders for the result spreadsheet: axis metadata, Tabulator column
// defs, row data, change signature, and height. No grid instance, no DOM state.
export function createResultGridModel({ runtime, getSampleAxis, isMappedWell, escapeHtml, toResultField }) {
  function axisDisplayLabel(axisKey) {
    return axisKey === 'sampleId' ? 'Sample ID' : 'Concentration';
  }

  function buildLayoutMap() {
    const map = {};
    (Array.isArray(runtime.currentLayout) ? runtime.currentLayout : []).forEach((item) => {
      const well = String(item?.well || '').trim().toUpperCase();
      if (!well) {
        return;
      }
      map[well] = {
        sampleId: String(item?.sampleId || '').trim(),
        concentration: String(item?.concentration || '').trim()
      };
    });
    return map;
  }

  function buildAxisMetadata(def) {
    const sampleAxis = typeof getSampleAxis === 'function' ? getSampleAxis() : 'row';
    const rowField = sampleAxis === 'row' ? 'sampleId' : 'concentration';
    const columnField = oppositeAxis(sampleAxis) === 'column' ? 'concentration' : 'sampleId';
    const layoutMap = buildLayoutMap();
    const rowValues = new Array(def.rows).fill('');
    const columnValues = new Array(def.columns).fill('');

    for (let rowIndex = 0; rowIndex < def.rows; rowIndex += 1) {
      for (let columnIndex = 0; columnIndex < def.columns; columnIndex += 1) {
        const mapping = layoutMap[wellIdFor(rowIndex, columnIndex)];
        if (!mapping) {
          continue;
        }
        if (!rowValues[rowIndex] && mapping[rowField]) {
          rowValues[rowIndex] = mapping[rowField];
        }
        if (!columnValues[columnIndex] && mapping[columnField]) {
          columnValues[columnIndex] = mapping[columnField];
        }
      }
    }

    return {
      rowField,
      columnField,
      rowValues,
      columnValues
    };
  }

  function buildResultGridSignature(def) {
    const metadata = buildAxisMetadata(def);
    return JSON.stringify({
      rows: def.rows,
      columns: def.columns,
      rowField: metadata.rowField,
      columnField: metadata.columnField,
      columnValues: metadata.columnValues
    });
  }

  function buildResultGridColumns(def, options = {}) {
    const metadata = buildAxisMetadata(def);
    const columns = [
      {
        title: '',
        field: 'rowLabel',
        width: 54,
        minWidth: 54,
        headerSort: false,
        hozAlign: 'center',
        frozen: true,
        editable: false
      },
      {
        title: axisDisplayLabel(metadata.rowField),
        field: 'rowMeta',
        width: 92,
        minWidth: 92,
        headerSort: false,
        hozAlign: 'center',
        frozen: true,
        editable: false,
        formatter: (cell) => String(cell.getValue() || '—')
      }
    ];
    for (let columnIndex = 0; columnIndex < def.columns; columnIndex += 1) {
      const metaValue = String(metadata.columnValues[columnIndex] || '').trim();
      columns.push({
        title: `
          <div class="assay-result-col-head">
            <span class="assay-result-col-index">${columnIndex + 1}</span>
            <span class="assay-result-col-meta">${escapeHtml(metaValue || '—')}</span>
          </div>
        `,
        field: toResultField(columnIndex),
        editor: options.editor || 'input',
        editable: (cell) => {
          const rowIndex = Number(cell.getRow()?.getData()?.__rowIndex);
          if (!Number.isFinite(rowIndex) || rowIndex < 0) {
            return false;
          }
          const well = wellIdFor(rowIndex, columnIndex);
          const mapped = isMappedWell(well);
          return typeof options.editable === 'function'
            ? options.editable(cell, { rowIndex, columnIndex, well, mapped })
            : mapped;
        },
        formatter: (cell) => {
          const rowIndex = Number(cell.getRow()?.getData()?.__rowIndex);
          const value = String(cell.getValue() || '');
          if (!Number.isFinite(rowIndex) || rowIndex < 0) {
            return value;
          }
          const well = wellIdFor(rowIndex, columnIndex);
          const mapped = isMappedWell(well);
          const element = cell.getElement();
          element.classList.toggle('assay-result-disabled', !mapped);
          if (typeof options.formatter === 'function') {
            return options.formatter(cell, { rowIndex, columnIndex, well, mapped, value });
          }
          if (!mapped) {
            return value || '—';
          }
          return value;
        },
        headerSort: false,
        hozAlign: 'center',
        headerHozAlign: 'center',
        minWidth: 76
      });
    }
    return columns;
  }

  function buildResultGridData(def, values = runtime.currentResults) {
    const metadata = buildAxisMetadata(def);
    const rows = [];
    for (let rowIndex = 0; rowIndex < def.rows; rowIndex += 1) {
      const row = {
        __rowIndex: rowIndex,
        rowLabel: toRowLabel(rowIndex),
        rowMeta: metadata.rowValues[rowIndex] || '—'
      };
      for (let columnIndex = 0; columnIndex < def.columns; columnIndex += 1) {
        const well = wellIdFor(rowIndex, columnIndex);
        row[toResultField(columnIndex)] = values?.[well] ?? '';
      }
      rows.push(row);
    }
    return rows;
  }

  function getResultGridHeight(def) {
    if (def.rows <= 14) {
      return '';
    }
    return `${(14 * 33) + 58}px`;
  }

  return {
    buildResultGridSignature,
    buildResultGridColumns,
    buildResultGridData,
    getResultGridHeight
  };
}
