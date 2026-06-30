import { axisLabel } from '../shared.js';
import { getPlateDefinition, parseWellId, toRowLabel } from '../plate-model.js';

// Builds the hidden agent-chat context describing the active assay plate.
export function createAssayAgentContext({
  runtime,
  elements,
  state,
  getAssayById,
  getLayoutManager,
  getResultsManager,
  hasUnsavedResultsDraft
}) {
  function compactAgentText(value, maxLength = 220) {
    const text = String(value ?? '').trim();
    return maxLength > 0 ? text.slice(0, maxLength) : text;
  }

  function getSelectedProjectForAgentContext(assay = null) {
    const projectId = compactAgentText(
      elements.assayProjectInput?.value
        || assay?.projectId
        || '',
      120
    );
    const project = projectId
      ? (state.projects || []).find((item) => item.id === projectId)
      : null;
    return {
      projectId,
      projectName: compactAgentText(project?.name || assay?.projectName || '', 220)
    };
  }

  function getActiveAssayForAgentContext() {
    const activeId = compactAgentText(
      runtime.activeResultsAssayId
        || elements.assayResultsAssaySelect?.value
        || elements.assayIdInput?.value
        || '',
      220
    );
    return activeId ? getAssayById(activeId) : null;
  }

  function getAgentLayoutForContext(assay = null) {
    const runtimeLayout = Array.isArray(runtime.currentLayout) ? runtime.currentLayout : [];
    if (runtimeLayout.length || !assay) {
      return runtimeLayout;
    }
    return Array.isArray(assay.wellLayout) ? assay.wellLayout : [];
  }

  function getAgentResultsForContext(assay = null) {
    if (runtime.assayMode === 'results') {
      getResultsManager()?.syncCurrentResultsFromGrid?.();
    }
    const runtimeResults = runtime.currentResults && typeof runtime.currentResults === 'object'
      ? runtime.currentResults
      : {};
    if (Object.keys(runtimeResults).length || !assay) {
      return runtimeResults;
    }
    return assay.resultValues && typeof assay.resultValues === 'object' ? assay.resultValues : {};
  }

  function cleanAgentTableCell(value, maxLength = 220) {
    return compactAgentText(value, maxLength)
      .replace(/[\t\r\n]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function buildAgentResultRows(layout = [], results = {}, maxRows = 384) {
    const rows = [];
    const seen = new Set();
    const resultByWell = {};
    const getWellPosition = (well) => {
      const parsed = parseWellId(well);
      if (!parsed) {
        return { row: '', column: '' };
      }
      return {
        row: toRowLabel(parsed.rowIndex),
        column: String(parsed.columnIndex + 1)
      };
    };
    Object.entries(results || {}).forEach(([rawWell, rawValue]) => {
      const well = cleanAgentTableCell(rawWell, 40).toUpperCase();
      if (well) {
        resultByWell[well] = rawValue;
      }
    });
    (Array.isArray(layout) ? layout : []).forEach((item) => {
      const well = cleanAgentTableCell(item?.well, 40).toUpperCase();
      if (!well || seen.has(well) || rows.length >= maxRows) {
        return;
      }
      seen.add(well);
      const hasResult = Object.prototype.hasOwnProperty.call(resultByWell, well);
      const position = getWellPosition(well);
      const row = {
        well,
        row: position.row,
        column: position.column,
        sample: cleanAgentTableCell(item?.sampleId, 160),
        concentration: cleanAgentTableCell(item?.concentration, 160),
        result: hasResult ? cleanAgentTableCell(resultByWell[well], 220) : ''
      };
      if (row.sample || row.concentration || row.result) {
        rows.push(row);
      }
    });
    Object.entries(resultByWell).forEach(([well, rawValue]) => {
      if (!well || seen.has(well) || rows.length >= maxRows) {
        return;
      }
      seen.add(well);
      const position = getWellPosition(well);
      rows.push({
        well,
        row: position.row,
        column: position.column,
        sample: '',
        concentration: '',
        result: cleanAgentTableCell(rawValue, 220)
      });
    });
    return rows;
  }

  function formatAgentTsvSection(title = '', columns = [], rows = [], maxRows = 384) {
    const safeColumns = (Array.isArray(columns) ? columns : [])
      .map((column) => cleanAgentTableCell(column, 80))
      .filter(Boolean);
    const safeRows = Array.isArray(rows) ? rows : [];
    if (!safeColumns.length || !safeRows.length) {
      return [];
    }
    const visibleRows = safeRows.slice(0, maxRows);
    const truncated = safeRows.length > visibleRows.length
      ? `; showing first ${visibleRows.length}`
      : '';
    return [
      `${title} (${safeRows.length} row${safeRows.length === 1 ? '' : 's'}${truncated}):`,
      safeColumns.join('\t'),
      ...visibleRows.map((row) => {
        const source = Array.isArray(row)
          ? row
          : (row && typeof row === 'object' ? row : {});
        return safeColumns.map((column, index) => (
          Array.isArray(source)
            ? cleanAgentTableCell(source[index], 220)
            : cleanAgentTableCell(source[column], 220)
        )).join('\t');
      })
    ];
  }

  function buildAgentAnalysisTableLines(latestAnalysis = null) {
    const headers = Array.isArray(latestAnalysis?.headers)
      ? latestAnalysis.headers.map((item) => cleanAgentTableCell(item, 120)).filter(Boolean)
      : [];
    const rows = Array.isArray(latestAnalysis?.rows) ? latestAnalysis.rows : [];
    return formatAgentTsvSection('Latest analysis table (TSV)', headers, rows, 120);
  }

  function buildAgentWellPreview(layout = [], results = {}, maxRows = 16) {
    const rows = (Array.isArray(layout) ? layout : [])
      .slice(0, maxRows)
      .map((item) => {
        const well = compactAgentText(item?.well, 40).toUpperCase();
        if (!well) {
          return '';
        }
        const result = compactAgentText(results?.[well], 80);
        return `- ${well}: sample=${compactAgentText(item?.sampleId, 120) || '-'}; concentration=${compactAgentText(item?.concentration, 120) || '-'}; result=${result || '-'}`;
      })
      .filter(Boolean);
    if (rows.length) {
      return rows;
    }
    return Object.entries(results || {})
      .slice(0, maxRows)
      .map(([well, value]) => `- ${compactAgentText(well, 40).toUpperCase()}: result=${compactAgentText(value, 80) || '-'}`);
  }

  function getAgentChatContext() {
    const layoutManager = getLayoutManager();
    const assay = getActiveAssayForAgentContext();
    const { projectId, projectName } = getSelectedProjectForAgentContext(assay);
    const assayId = compactAgentText(assay?.id || elements.assayIdInput?.value || '', 220);
    const assayName = compactAgentText(elements.assayNameInput?.value || assay?.name || '', 320);
    const assayNumber = compactAgentText(assay?.assayNumber || elements.assayNumberDisplay?.textContent || '', 120);
    const plateDef = getPlateDefinition(elements.assayPlateTypeInput?.value || assay?.plateType || '96');
    const layout = getAgentLayoutForContext(assay);
    const results = getAgentResultsForContext(assay);
    const resultCount = Object.keys(results || {}).length;
    const resultsDraftChanged = hasUnsavedResultsDraft();
    const latestAnalysis = !resultsDraftChanged && assay?.latestAnalysis && typeof assay.latestAnalysis === 'object'
      ? assay.latestAnalysis
      : null;
    const analysisMethod = compactAgentText(elements.assayAnalysisMethodInput?.value || latestAnalysis?.method || '', 120);
    const resultRows = buildAgentResultRows(layout, results);
    const resultTableLines = formatAgentTsvSection(
      'Assay plate data (TSV; complete active mapped wells/results for assay_table create)',
      ['well', 'row', 'column', 'sample', 'concentration', 'result'],
      resultRows,
      384
    );
    const analysisTableLines = buildAgentAnalysisTableLines(latestAnalysis);
    const wellPreview = buildAgentWellPreview(layout, results);
    const lines = [
      `Active assay mode: ${runtime.assayMode === 'results' ? 'Results and analysis' : 'Plate setup'}`,
      assayName ? `Assay name: ${assayName}` : '',
      assayNumber ? `Assay number: ${assayNumber}` : '',
      assayId ? `Assay ID: ${assayId}` : 'Assay ID: unsaved draft',
      projectName ? `Project: ${projectName}` : '',
      `Plate: ${plateDef.label || plateDef.value}`,
      `Sample axis: ${axisLabel(elements.assaySampleAxisInput?.value || assay?.sampleAxis || 'row')}`,
      `Concentration axis: ${axisLabel(elements.assayConcentrationAxisInput?.value || assay?.concentrationAxis || 'column')}`,
      compactAgentText(layoutManager.getConcentrationUnit?.() || assay?.concentrationUnit || '', 80)
        ? `Concentration unit: ${compactAgentText(layoutManager.getConcentrationUnit?.() || assay?.concentrationUnit || '', 80)}`
        : '',
      `Mapped wells: ${layout.length}`,
      `Result values: ${resultCount}`,
      analysisMethod ? `Analysis method: ${analysisMethod}` : '',
      compactAgentText(elements.assayAnalysisRowGroupsInput?.value, 500)
        ? `Row groups: ${compactAgentText(elements.assayAnalysisRowGroupsInput.value, 500)}`
        : '',
      compactAgentText(elements.assayAnalysisColumnGroupsInput?.value, 500)
        ? `Column groups: ${compactAgentText(elements.assayAnalysisColumnGroupsInput.value, 500)}`
        : '',
      elements.assayAnalysisErrorBarsInput?.checked ? 'Error bars: SD enabled' : '',
      resultsDraftChanged ? 'Latest analysis summary: omitted because result values have unsaved changes.' : '',
      latestAnalysis?.summary ? `Latest analysis summary: ${compactAgentText(latestAnalysis.summary, 700)}` : '',
      ...analysisTableLines,
      ...resultTableLines,
      resultTableLines.length ? '' : (wellPreview.length ? 'Well/result preview:' : ''),
      ...(resultTableLines.length ? [] : wellPreview)
    ].filter(Boolean);

    return {
      scopeType: 'assay',
      assayId,
      assayName: assayName || assayNumber,
      assayMode: runtime.assayMode,
      projectId,
      projectName,
      hiddenContext: {
        kind: 'assay-page',
        label: assayName ? `Active assay: ${assayName}` : 'Active assay',
        text: lines.join('\n'),
        assayId,
        assayName: assayName || assayNumber,
        projectName
      }
    };
  }

  return { getAgentChatContext };
}
