import { buildQuantificationSignal } from '../analysis/image-processing.js';
import { clamp, normalizeManualOverrides } from '../shared.js';
import { formatTableNumber, makeProfilePoint } from './profile-shape.js';
import {
  PEAK_EDITOR_COLUMNS,
  calculatePeakIntegrationRows,
  getPeakEditorScales,
  getPeakEditorSvgXFromEvent,
  renderPeakEditorSvg
} from './peak-editor-svg.js';

export function createPeakEditorController({
  runtime,
  elements,
  safeText,
  deps = {},
  computeLaneIntensityProfile,
  drawCanvas,
  getLaneProfileLanes,
  renderLaneProfile
}) {
  function ensurePeakEditorState() {
    runtime.peakEditor = {
      open: false,
      mode: 'baseline',
      laneIndex: runtime.selectedLaneProfileLane || null,
      ...(runtime.peakEditor || {})
    };
    if (runtime.peakEditor.mode !== 'divider') {
      runtime.peakEditor.mode = 'baseline';
    }
    return runtime.peakEditor;
  }

  function setPeakEditorStatus(message) {
    if (elements.gelPeakEditorSummary) {
      elements.gelPeakEditorSummary.textContent = message || '';
    }
  }

  function computeProfileForLane(lane) {
    if (!runtime.currentImage || !lane) {
      return null;
    }
    const { signal } = buildQuantificationSignal(runtime.currentImage.gray);
    return signal ? computeLaneIntensityProfile({
      signal,
      width: runtime.currentImage.width,
      height: runtime.currentImage.height,
      lane
    }) : null;
  }

  function getSelectedPeakEditorLane(lanes = getLaneProfileLanes()) {
    const state = ensurePeakEditorState();
    if (!lanes.length) {
      state.laneIndex = null;
      return null;
    }
    const preferredLane = Number(state.laneIndex || runtime.selectedLaneProfileLane);
    const selected = lanes.find((lane) => lane.laneIndex === preferredLane) || lanes[0];
    state.laneIndex = selected.laneIndex;
    runtime.selectedLaneProfileLane = selected.laneIndex;
    return selected;
  }

  function getPeakIntegrationsForLane(laneIndex) {
    return normalizeManualOverrides(runtime.manualOverrides).peakIntegrations
      .filter((integration) => integration.laneIndex === laneIndex);
  }

  function setPeakIntegrations(integrations) {
    runtime.manualOverrides = {
      ...normalizeManualOverrides(runtime.manualOverrides),
      peakIntegrations: integrations
    };
  }

  function getPeakEditorRowFromEvent(event, profile) {
    const rowMax = Math.max(0, (profile?.values?.length || 1) - 1);
    if (Number.isFinite(Number(event?.row))) {
      return clamp(Math.round(Number(event.row)), 0, rowMax);
    }
    const svg = elements.gelPeakEditorChart;
    const svgX = getPeakEditorSvgXFromEvent(svg, event);
    if (!Number.isFinite(svgX)) {
      return null;
    }
    return clamp(getPeakEditorScales(profile).xToRow(svgX), 0, rowMax);
  }

  function getAllPeakIntegrationRows() {
    const lanes = getLaneProfileLanes();
    if (!lanes.length) {
      return [];
    }
    const integrations = normalizeManualOverrides(runtime.manualOverrides).peakIntegrations;
    return lanes.flatMap((lane) => {
      const profile = computeProfileForLane(lane);
      if (!profile) {
        return [];
      }
      return calculatePeakIntegrationRows(
        profile,
        integrations.filter((integration) => integration.laneIndex === lane.laneIndex)
      );
    });
  }

  function renderPeakEditorChartOnly(nextHoverRow) {
    if (!elements.gelPeakEditorChart) {
      return;
    }
    const hasHoverOverride = arguments.length > 0;
    const state = ensurePeakEditorState();
    if (!state.open) {
      return;
    }
    const lanes = getLaneProfileLanes();
    const selectedLane = getSelectedPeakEditorLane(lanes);
    const profile = selectedLane ? computeProfileForLane(selectedLane) : null;
    const laneIntegrations = selectedLane ? getPeakIntegrationsForLane(selectedLane.laneIndex) : [];
    renderPeakEditorSvg(
      elements.gelPeakEditorChart,
      profile,
      laneIntegrations,
      hasHoverOverride ? nextHoverRow : state.hoverRow,
      state.mode
    );
  }

  function renderPeakIntegrationTable(rows) {
    const host = elements.gelPeakEditorTable;
    if (!host) {
      return;
    }

    const tableRows = rows.map((row) => ({
      ...row,
      apexValue: formatTableNumber(row.apexValue),
      area: formatTableNumber(row.area),
      rawArea: formatTableNumber(row.rawArea),
      baselineArea: formatTableNumber(row.baselineArea)
    }));

    if (typeof window !== 'undefined' && typeof window.Tabulator === 'function') {
      if (!runtime.peakIntegrationTable) {
        runtime.peakIntegrationTable = new window.Tabulator(host, {
          data: tableRows,
          columns: PEAK_EDITOR_COLUMNS,
          layout: 'fitColumns',
          height: '100%',
          placeholder: 'No peak areas selected'
        });
      } else if (typeof runtime.peakIntegrationTable.setData === 'function') {
        runtime.peakIntegrationTable.setData(tableRows);
      }
      return;
    }

    const rowsHtml = tableRows.map((row) => `
      <tr>
        <td class="num">${safeText(row.laneIndex)}</td>
        <td class="num">${safeText(row.baselineIndex)}</td>
        <td class="num">${safeText(row.peakIndex)}</td>
        <td class="num">${safeText(row.startRow)}</td>
        <td class="num">${safeText(row.endRow)}</td>
        <td class="num">${safeText(row.apexRow)}</td>
        <td class="num">${safeText(row.apexValue)}</td>
        <td class="num">${safeText(row.area)}</td>
        <td class="num">${safeText(row.rawArea)}</td>
        <td class="num">${safeText(row.baselineArea)}</td>
      </tr>
    `).join('');
    host.innerHTML = `
      <table class="gel-peak-table">
        <thead>
          <tr>
            ${PEAK_EDITOR_COLUMNS.map((column) => `<th>${safeText(column.title)}</th>`).join('')}
          </tr>
        </thead>
        <tbody>${rowsHtml || '<tr><td colspan="10">No peak areas selected</td></tr>'}</tbody>
      </table>
    `;
  }

  function renderPeakEditor() {
    const overlay = elements.gelPeakEditorOverlay;
    if (!overlay) {
      return;
    }

    const state = ensurePeakEditorState();
    overlay.hidden = !state.open;
    if (!state.open) {
      return;
    }

    const lanes = getLaneProfileLanes();
    const selectedLane = getSelectedPeakEditorLane(lanes);
    if (elements.gelPeakEditorLaneSelect) {
      elements.gelPeakEditorLaneSelect.disabled = !lanes.length;
      elements.gelPeakEditorLaneSelect.innerHTML = lanes.length
        ? lanes.map((lane) => `<option value="${lane.laneIndex}">Lane ${lane.laneIndex}</option>`).join('')
        : '<option value="">No lanes</option>';
      elements.gelPeakEditorLaneSelect.value = selectedLane ? String(selectedLane.laneIndex) : '';
    }
    if (elements.gelPeakEditorBaselineModeBtn) {
      elements.gelPeakEditorBaselineModeBtn.classList.toggle('is-active', state.mode === 'baseline');
      elements.gelPeakEditorBaselineModeBtn.setAttribute?.('aria-pressed', String(state.mode === 'baseline'));
    }
    if (elements.gelPeakEditorDividerModeBtn) {
      elements.gelPeakEditorDividerModeBtn.classList.toggle('is-active', state.mode === 'divider');
      elements.gelPeakEditorDividerModeBtn.setAttribute?.('aria-pressed', String(state.mode === 'divider'));
    }

    const profile = selectedLane ? computeProfileForLane(selectedLane) : null;
    const laneIntegrations = selectedLane ? getPeakIntegrationsForLane(selectedLane.laneIndex) : [];
    if (elements.gelPeakEditorChart) {
      renderPeakEditorSvg(
        elements.gelPeakEditorChart,
        profile,
        laneIntegrations,
        state.hoverRow,
        state.mode
      );
    }

    renderPeakIntegrationTable(getAllPeakIntegrationRows());
    // Only the guidance stays; the per-lane counts are already in the table below.
    setPeakEditorStatus(selectedLane ? '' : 'Divide the gel into lanes before editing peak areas.');
  }

  function onPeakEditorOpen() {
    if (!runtime.currentImage) {
      deps.setStatus?.('Load a gel image before opening the peak editor.');
      return;
    }
    const state = ensurePeakEditorState();
    state.open = true;
    state.laneIndex = runtime.selectedLaneProfileLane || state.laneIndex;
    renderPeakEditor();
  }

  function onPeakEditorClose() {
    const state = ensurePeakEditorState();
    state.open = false;
    state.hoverRow = null;
    renderPeakEditor();
  }

  function onPeakEditorModeSelected(mode) {
    const state = ensurePeakEditorState();
    state.mode = mode === 'divider' ? 'divider' : 'baseline';
    if (state.mode !== 'baseline') {
      state.hoverRow = null;
    }
    renderPeakEditor();
  }

  function onPeakEditorLaneChange(event) {
    const nextLane = Number(event?.target?.value);
    const state = ensurePeakEditorState();
    state.laneIndex = Number.isFinite(nextLane) && nextLane > 0 ? Math.floor(nextLane) : null;
    state.hoverRow = null;
    runtime.selectedLaneProfileLane = state.laneIndex;
    runtime.laneProfileHoverY = null;
    renderLaneProfile();
    renderPeakEditor();
    drawCanvas();
  }

  function onPeakEditorChartClick(event) {
    const lanes = getLaneProfileLanes();
    const selectedLane = getSelectedPeakEditorLane(lanes);
    const profile = selectedLane ? computeProfileForLane(selectedLane) : null;
    if (!selectedLane || !profile) {
      setPeakEditorStatus('Divide the gel into lanes before editing peak areas.');
      return;
    }

    const row = getPeakEditorRowFromEvent(event, profile);
    if (!Number.isFinite(row)) {
      return;
    }

    const point = makeProfilePoint(profile, row);
    const overrides = normalizeManualOverrides(runtime.manualOverrides);
    const nextIntegrations = overrides.peakIntegrations.map((integration) => ({
      ...integration,
      dividers: [...(integration.dividers || [])]
    }));
    const state = ensurePeakEditorState();

    if (state.mode === 'divider') {
      const candidates = nextIntegrations
        .map((integration, index) => ({ integration, index }))
        .filter(({ integration }) => {
          if (integration.laneIndex !== selectedLane.laneIndex || !integration.left || !integration.right) {
            return false;
          }
          const start = Math.min(integration.left.row, integration.right.row);
          const end = Math.max(integration.left.row, integration.right.row);
          return row > start && row < end;
        })
        .sort((a, b) => {
          const aSpan = Math.abs(a.integration.right.row - a.integration.left.row);
          const bSpan = Math.abs(b.integration.right.row - b.integration.left.row);
          return aSpan - bSpan;
        });
      const target = candidates[0];
      if (!target) {
        setPeakEditorStatus('Add a complete baseline before adding vertical peak dividers.');
        return;
      }
      const dividers = new Set(target.integration.dividers || []);
      dividers.add(point.row);
      nextIntegrations[target.index] = {
        ...target.integration,
        dividers: [...dividers].sort((a, b) => a - b)
      };
      setPeakIntegrations(nextIntegrations);
      renderPeakEditor();
      return;
    }

    const draftIndex = nextIntegrations.findIndex((integration) => (
      integration.laneIndex === selectedLane.laneIndex
      && integration.left
      && !integration.right
    ));
    if (draftIndex >= 0) {
      if (nextIntegrations[draftIndex].left.row === point.row) {
        setPeakEditorStatus('Choose a second baseline point at a different row.');
        return;
      }
      nextIntegrations[draftIndex] = {
        ...nextIntegrations[draftIndex],
        right: point
      };
    } else {
      nextIntegrations.push({
        laneIndex: selectedLane.laneIndex,
        left: point,
        right: null,
        dividers: []
      });
    }
    setPeakIntegrations(nextIntegrations);
    renderPeakEditor();
  }

  function onPeakEditorChartMouseMove(event) {
    const state = ensurePeakEditorState();
    if (!state.open || state.mode !== 'baseline') {
      return;
    }
    const lanes = getLaneProfileLanes();
    const selectedLane = getSelectedPeakEditorLane(lanes);
    const profile = selectedLane ? computeProfileForLane(selectedLane) : null;
    if (!profile) {
      return;
    }
    const row = getPeakEditorRowFromEvent(event, profile);
    if (!Number.isFinite(row)) {
      return;
    }
    if (state.hoverRow === row) {
      return;
    }
    state.hoverRow = row;
    renderPeakEditorChartOnly(row);
  }

  function onPeakEditorChartMouseLeave() {
    const state = ensurePeakEditorState();
    if (!state.open) {
      return;
    }
    state.hoverRow = null;
    renderPeakEditorChartOnly(null);
  }

  function onPeakEditorClearLane() {
    const selectedLane = getSelectedPeakEditorLane();
    if (!selectedLane) {
      return;
    }
    const overrides = normalizeManualOverrides(runtime.manualOverrides);
    setPeakIntegrations(overrides.peakIntegrations.filter((integration) => integration.laneIndex !== selectedLane.laneIndex));
    renderPeakEditor();
  }

  function onPeakEditorClearAll() {
    setPeakIntegrations([]);
    renderPeakEditor();
  }

  return {
    onPeakEditorChartClick,
    onPeakEditorChartMouseLeave,
    onPeakEditorChartMouseMove,
    onPeakEditorClearAll,
    onPeakEditorClearLane,
    onPeakEditorClose,
    onPeakEditorLaneChange,
    onPeakEditorModeSelected,
    onPeakEditorOpen,
    renderPeakEditor
  };
}
