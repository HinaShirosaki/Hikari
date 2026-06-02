import {
  createChartStylePicker,
  SHAPE_OPTIONS,
  LINE_STYLE_OPTIONS,
  FRAME_STYLE_OPTIONS,
  POINT_SIZE_OPTIONS,
  LINE_WIDTH_OPTIONS,
  STROKE_WIDTH_OPTIONS,
  CORNER_RADIUS_OPTIONS,
  FRAME_WIDTH_OPTIONS,
  FRAME_HEIGHT_OPTIONS
} from './chart-style-pickers.js';
import { createChartTextControls } from './chart-text-controls.js';

function nearestOption(value, options) {
  if (!options.length) return value;
  if (!Number.isFinite(value)) return options[0].value;
  let best = options[0].value;
  let bestDist = Math.abs(value - best);
  for (let i = 1; i < options.length; i++) {
    const dist = Math.abs(value - options[i].value);
    if (dist < bestDist) {
      bestDist = dist;
      best = options[i].value;
    }
  }
  return best;
}

export function createAssayChartStyleControls({ elements, analysisView, safeText, onStyleChanged }) {
  const fieldKeys = [
    'assayChartXColumn',
    'assayChartYColumn',
    'assayChartSeriesColumn',
    'assayChartXScale',
    'assayChartYScale',
    'assayChartXRangeAuto',
    'assayChartXMin',
    'assayChartXMax',
    'assayChartYRangeAuto',
    'assayChartYMin',
    'assayChartYMax',
    'assayChartPointShape',
    'assayChartPointSize',
    'assayChartLineStyle',
    'assayChartCurve',
    'assayChartLineWidth',
    'assayChartFrameStyle',
    'assayChartFrameStroke',
    'assayChartFrameStrokeWidth',
    'assayChartFrameCornerRadius',
    'assayChartBackgroundColor',
    'assayChartSizeAuto',
    'assayChartFrameWidth',
    'assayChartFrameHeight',
    'assayChartGridVertical',
    'assayChartGridHorizontal',
    'assayChartGridColor',
    'assayChartGridStrokeWidth'
  ];

  if (!fieldKeys.some((key) => elements[key])) {
    return {
      refresh() {},
      destroy() {}
    };
  }

  let suppressInputEvents = false;
  const seriesColorListeners = [];
  const pickers = {};
  let textControls = null;

  function emitChange() {
    if (suppressInputEvents) return;
    applyPatch(readFormPatch());
  }

  function buildPickers() {
    if (elements.assayChartPointShape) {
      pickers.pointShape = createChartStylePicker(elements.assayChartPointShape, {
        kind: 'shape',
        options: SHAPE_OPTIONS,
        value: 'circle',
        onChange: () => {
          if (pickers.pointSize) {
            pickers.pointSize.setShapeContext(pickers.pointShape.value);
          }
          emitChange();
        }
      });
    }
    if (elements.assayChartPointSize) {
      pickers.pointSize = createChartStylePicker(elements.assayChartPointSize, {
        kind: 'point-size',
        options: POINT_SIZE_OPTIONS,
        value: POINT_SIZE_OPTIONS[1].value,
        shapeContext: pickers.pointShape ? pickers.pointShape.value : 'circle',
        onChange: emitChange
      });
    }
    if (elements.assayChartLineStyle) {
      pickers.lineStyle = createChartStylePicker(elements.assayChartLineStyle, {
        kind: 'line-style',
        options: LINE_STYLE_OPTIONS,
        value: 'solid',
        onChange: emitChange
      });
    }
    if (elements.assayChartLineWidth) {
      pickers.lineWidth = createChartStylePicker(elements.assayChartLineWidth, {
        kind: 'line-width',
        options: LINE_WIDTH_OPTIONS,
        value: 1.5,
        onChange: emitChange
      });
    }
    if (elements.assayChartFrameStyle) {
      pickers.frameStyle = createChartStylePicker(elements.assayChartFrameStyle, {
        kind: 'frame-style',
        options: FRAME_STYLE_OPTIONS,
        value: 'box',
        onChange: emitChange
      });
    }
    if (elements.assayChartFrameStrokeWidth) {
      pickers.frameStrokeWidth = createChartStylePicker(elements.assayChartFrameStrokeWidth, {
        kind: 'stroke-width',
        options: STROKE_WIDTH_OPTIONS,
        value: 1,
        onChange: emitChange
      });
    }
    if (elements.assayChartFrameCornerRadius) {
      pickers.frameCornerRadius = createChartStylePicker(elements.assayChartFrameCornerRadius, {
        kind: 'corner-radius',
        options: CORNER_RADIUS_OPTIONS,
        value: 0,
        onChange: emitChange
      });
    }
    if (elements.assayChartFrameWidth) {
      pickers.frameWidth = createChartStylePicker(elements.assayChartFrameWidth, {
        kind: 'dim-width',
        options: FRAME_WIDTH_OPTIONS,
        value: 720,
        min: FRAME_WIDTH_OPTIONS[0].value,
        max: FRAME_WIDTH_OPTIONS[FRAME_WIDTH_OPTIONS.length - 1].value,
        onChange: emitChange
      });
    }
    if (elements.assayChartFrameHeight) {
      pickers.frameHeight = createChartStylePicker(elements.assayChartFrameHeight, {
        kind: 'dim-height',
        options: FRAME_HEIGHT_OPTIONS,
        value: 360,
        min: FRAME_HEIGHT_OPTIONS[0].value,
        max: FRAME_HEIGHT_OPTIONS[FRAME_HEIGHT_OPTIONS.length - 1].value,
        onChange: emitChange
      });
    }
    if (elements.assayChartGridStrokeWidth) {
      pickers.gridStrokeWidth = createChartStylePicker(elements.assayChartGridStrokeWidth, {
        kind: 'grid-width',
        options: STROKE_WIDTH_OPTIONS,
        value: 1,
        onChange: emitChange
      });
    }
    if (elements.assayChartTextBar) {
      const initialText = analysisView.getChartStyle().text || {};
      textControls = createChartTextControls(elements.assayChartTextBar, {
        value: initialText,
        onChange: (textValue) => {
          if (suppressInputEvents) return;
          applyPatch({ text: textValue });
        }
      });
    }
  }

  function populateColumnOptions(select, headers) {
    if (!select) return;
    const current = select.value || 'auto';
    const options = ['<option value="auto">Auto</option>'];
    headers.forEach((header) => {
      const label = String(header || '').trim();
      if (!label) return;
      options.push(`<option value="${safeText(label)}">${safeText(label)}</option>`);
    });
    select.innerHTML = options.join('');
    select.value = headers.includes(current) || current === 'auto' ? current : 'auto';
  }

  function setValueIfPresent(input, value) {
    if (!input) return;
    if (input.type === 'checkbox') {
      input.checked = Boolean(value);
    } else if (value === null || value === undefined) {
      input.value = '';
    } else {
      input.value = String(value);
    }
  }

  function setPickerValue(picker, value, options) {
    if (!picker) return;
    const snapped = options ? nearestOption(Number(value), options) : value;
    picker.setValue(snapped);
  }

  function syncFormFromStyle() {
    const style = analysisView.getChartStyle();
    const ctx = analysisView.getChartContext();
    populateColumnOptions(elements.assayChartXColumn, ctx.headers);
    populateColumnOptions(elements.assayChartYColumn, ctx.headers);
    populateColumnOptions(elements.assayChartSeriesColumn, ctx.headers);
    elements.assayChartXColumn && (elements.assayChartXColumn.value = ctx.headers.includes(style.xColumn) ? style.xColumn : 'auto');
    elements.assayChartYColumn && (elements.assayChartYColumn.value = ctx.headers.includes(style.yColumn) ? style.yColumn : 'auto');
    elements.assayChartSeriesColumn && (elements.assayChartSeriesColumn.value = ctx.headers.includes(style.seriesColumn) ? style.seriesColumn : 'auto');

    setValueIfPresent(elements.assayChartXScale, style.xScale);
    setValueIfPresent(elements.assayChartYScale, style.yScale);
    setValueIfPresent(elements.assayChartXRangeAuto, style.xRange.auto);
    setValueIfPresent(elements.assayChartXMin, style.xRange.min);
    setValueIfPresent(elements.assayChartXMax, style.xRange.max);
    setValueIfPresent(elements.assayChartYRangeAuto, style.yRange.auto);
    setValueIfPresent(elements.assayChartYMin, style.yRange.min);
    setValueIfPresent(elements.assayChartYMax, style.yRange.max);

    if (pickers.pointShape) pickers.pointShape.setValue(style.pointShape);
    setPickerValue(pickers.pointSize, style.pointSize, POINT_SIZE_OPTIONS);
    if (pickers.pointSize) pickers.pointSize.setShapeContext(style.pointShape);
    if (pickers.lineStyle) pickers.lineStyle.setValue(style.lineStyle);
    setValueIfPresent(elements.assayChartCurve, style.curve);
    setPickerValue(pickers.lineWidth, style.lineWidth, LINE_WIDTH_OPTIONS);
    if (pickers.frameStyle) pickers.frameStyle.setValue(style.frameStyle);
    setValueIfPresent(elements.assayChartFrameStroke, style.frameStroke);
    setPickerValue(pickers.frameStrokeWidth, style.frameStrokeWidth, STROKE_WIDTH_OPTIONS);
    setPickerValue(pickers.frameCornerRadius, style.frameCornerRadius, CORNER_RADIUS_OPTIONS);
    setValueIfPresent(elements.assayChartBackgroundColor, style.backgroundColor);
    setValueIfPresent(elements.assayChartSizeAuto, style.sizeAuto !== false);
    setPickerValue(
      pickers.frameWidth,
      Number.isFinite(style.frameWidth) ? style.frameWidth : 720,
      FRAME_WIDTH_OPTIONS
    );
    setPickerValue(
      pickers.frameHeight,
      Number.isFinite(style.frameHeight) ? style.frameHeight : 360,
      FRAME_HEIGHT_OPTIONS
    );
    setValueIfPresent(elements.assayChartGridVertical, style.showVerticalGrid !== false);
    setValueIfPresent(elements.assayChartGridHorizontal, style.showHorizontalGrid !== false);
    setValueIfPresent(elements.assayChartGridColor, style.gridColor);
    setPickerValue(pickers.gridStrokeWidth, style.gridStrokeWidth, STROKE_WIDTH_OPTIONS);
    if (textControls) textControls.setValue(style.text || {});

    applyRangeDisabledState();
    applySizeDisabledState();
    renderSeriesColors(style, ctx.seriesLabels);
  }

  function applyRangeDisabledState() {
    if (elements.assayChartXMin) {
      elements.assayChartXMin.disabled = Boolean(elements.assayChartXRangeAuto?.checked);
    }
    if (elements.assayChartXMax) {
      elements.assayChartXMax.disabled = Boolean(elements.assayChartXRangeAuto?.checked);
    }
    if (elements.assayChartYMin) {
      elements.assayChartYMin.disabled = Boolean(elements.assayChartYRangeAuto?.checked);
    }
    if (elements.assayChartYMax) {
      elements.assayChartYMax.disabled = Boolean(elements.assayChartYRangeAuto?.checked);
    }
  }

  function applySizeDisabledState() {
    const auto = Boolean(elements.assayChartSizeAuto?.checked);
    if (elements.assayChartFrameWidth) {
      elements.assayChartFrameWidth.classList.toggle('is-disabled', auto);
    }
    if (elements.assayChartFrameHeight) {
      elements.assayChartFrameHeight.classList.toggle('is-disabled', auto);
    }
  }

  function clearSeriesColorListeners() {
    while (seriesColorListeners.length) {
      const { input, handler } = seriesColorListeners.pop();
      input.removeEventListener('input', handler);
    }
  }

  function renderSeriesColors(style, seriesLabels) {
    const container = elements.assayChartSeriesColors;
    if (!container) return;
    clearSeriesColorListeners();
    container.innerHTML = '';
    if (!seriesLabels.length) {
      const empty = document.createElement('p');
      empty.className = 'assay-chart-style-series-empty';
      empty.textContent = 'Run analysis to configure series colors.';
      container.appendChild(empty);
      return;
    }
    seriesLabels.forEach((label, index) => {
      const row = document.createElement('div');
      row.className = 'assay-chart-style-series-row';
      const labelEl = document.createElement('span');
      labelEl.textContent = label || `Series ${index + 1}`;
      const input = document.createElement('input');
      input.type = 'color';
      const seriesColor = style.seriesColors[label]
        || style.palette[index % style.palette.length]
        || '#1f77b4';
      input.value = seriesColor;
      const handler = () => {
        const next = { ...style.seriesColors, [label]: input.value };
        applyPatch({ seriesColors: next });
      };
      input.addEventListener('input', handler);
      seriesColorListeners.push({ input, handler });
      row.appendChild(labelEl);
      row.appendChild(input);
      container.appendChild(row);
    });
  }

  function parseRangeNumber(input) {
    if (!input) return null;
    const raw = input.value;
    if (raw === '' || raw === null || raw === undefined) {
      return null;
    }
    const num = Number(raw);
    return Number.isFinite(num) ? num : null;
  }

  function pickerNumberValue(picker, fallback) {
    if (!picker) return fallback;
    const v = Number(picker.value);
    return Number.isFinite(v) ? v : fallback;
  }

  function readFormPatch() {
    const style = analysisView.getChartStyle();
    return {
      xColumn: elements.assayChartXColumn?.value || 'auto',
      yColumn: elements.assayChartYColumn?.value || 'auto',
      seriesColumn: elements.assayChartSeriesColumn?.value || 'auto',
      xScale: elements.assayChartXScale?.value || 'auto',
      yScale: elements.assayChartYScale?.value || 'linear',
      xRange: {
        auto: Boolean(elements.assayChartXRangeAuto?.checked),
        min: parseRangeNumber(elements.assayChartXMin),
        max: parseRangeNumber(elements.assayChartXMax)
      },
      yRange: {
        auto: Boolean(elements.assayChartYRangeAuto?.checked),
        min: parseRangeNumber(elements.assayChartYMin),
        max: parseRangeNumber(elements.assayChartYMax)
      },
      pointShape: pickers.pointShape ? pickers.pointShape.value : style.pointShape,
      pointSize: pickerNumberValue(pickers.pointSize, style.pointSize),
      lineStyle: pickers.lineStyle ? pickers.lineStyle.value : style.lineStyle,
      curve: elements.assayChartCurve?.value || style.curve,
      lineWidth: pickerNumberValue(pickers.lineWidth, style.lineWidth),
      frameStyle: pickers.frameStyle ? pickers.frameStyle.value : style.frameStyle,
      frameStroke: elements.assayChartFrameStroke?.value || style.frameStroke,
      frameStrokeWidth: pickerNumberValue(pickers.frameStrokeWidth, style.frameStrokeWidth),
      frameCornerRadius: pickerNumberValue(pickers.frameCornerRadius, style.frameCornerRadius),
      backgroundColor: elements.assayChartBackgroundColor?.value || style.backgroundColor,
      sizeAuto: elements.assayChartSizeAuto
        ? Boolean(elements.assayChartSizeAuto.checked)
        : style.sizeAuto,
      frameWidth: pickerNumberValue(pickers.frameWidth, style.frameWidth),
      frameHeight: pickerNumberValue(pickers.frameHeight, style.frameHeight),
      showVerticalGrid: elements.assayChartGridVertical
        ? Boolean(elements.assayChartGridVertical.checked)
        : style.showVerticalGrid,
      showHorizontalGrid: elements.assayChartGridHorizontal
        ? Boolean(elements.assayChartGridHorizontal.checked)
        : style.showHorizontalGrid,
      gridColor: elements.assayChartGridColor?.value || style.gridColor,
      gridStrokeWidth: pickerNumberValue(pickers.gridStrokeWidth, style.gridStrokeWidth)
    };
  }

  function applyPatch(patch) {
    analysisView.setChartStyle(patch);
    applyRangeDisabledState();
    applySizeDisabledState();
    if (typeof onStyleChanged === 'function') {
      onStyleChanged(analysisView.getChartStyle());
    }
  }

  function onFormInput() {
    if (suppressInputEvents) return;
    applyPatch(readFormPatch());
  }

  function onResetClick() {
    analysisView.resetChartStyle();
    suppressInputEvents = true;
    syncFormFromStyle();
    suppressInputEvents = false;
    if (typeof onStyleChanged === 'function') {
      onStyleChanged(analysisView.getChartStyle());
    }
  }

  const nativeInputBindings = [
    elements.assayChartXColumn,
    elements.assayChartYColumn,
    elements.assayChartSeriesColumn,
    elements.assayChartXScale,
    elements.assayChartYScale,
    elements.assayChartXRangeAuto,
    elements.assayChartXMin,
    elements.assayChartXMax,
    elements.assayChartYRangeAuto,
    elements.assayChartYMin,
    elements.assayChartYMax,
    elements.assayChartCurve,
    elements.assayChartFrameStroke,
    elements.assayChartBackgroundColor,
    elements.assayChartSizeAuto,
    elements.assayChartGridVertical,
    elements.assayChartGridHorizontal,
    elements.assayChartGridColor
  ];

  buildPickers();
  nativeInputBindings.forEach((input) => {
    if (!input) return;
    const event = input.tagName === 'SELECT' || input.type === 'checkbox' ? 'change' : 'input';
    input.addEventListener(event, onFormInput);
  });
  elements.assayChartStyleResetBtn?.addEventListener('click', onResetClick);

  suppressInputEvents = true;
  syncFormFromStyle();
  suppressInputEvents = false;

  return {
    refresh() {
      suppressInputEvents = true;
      syncFormFromStyle();
      suppressInputEvents = false;
    },
    destroy() {
      nativeInputBindings.forEach((input) => {
        if (!input) return;
        const event = input.tagName === 'SELECT' || input.type === 'checkbox' ? 'change' : 'input';
        input.removeEventListener(event, onFormInput);
      });
      elements.assayChartStyleResetBtn?.removeEventListener('click', onResetClick);
      clearSeriesColorListeners();
      Object.values(pickers).forEach((picker) => picker && picker.destroy());
      if (textControls) textControls.destroy();
    }
  };
}
