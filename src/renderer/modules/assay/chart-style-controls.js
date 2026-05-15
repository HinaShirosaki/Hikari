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
    setValueIfPresent(elements.assayChartPointShape, style.pointShape);
    setValueIfPresent(elements.assayChartPointSize, style.pointSize);
    setValueIfPresent(elements.assayChartLineStyle, style.lineStyle);
    setValueIfPresent(elements.assayChartCurve, style.curve);
    setValueIfPresent(elements.assayChartLineWidth, style.lineWidth);
    setValueIfPresent(elements.assayChartFrameStyle, style.frameStyle);
    setValueIfPresent(elements.assayChartFrameStroke, style.frameStroke);
    setValueIfPresent(elements.assayChartFrameStrokeWidth, style.frameStrokeWidth);
    setValueIfPresent(elements.assayChartFrameCornerRadius, style.frameCornerRadius);
    setValueIfPresent(elements.assayChartBackgroundColor, style.backgroundColor);
    setValueIfPresent(elements.assayChartSizeAuto, style.sizeAuto !== false);
    setValueIfPresent(
      elements.assayChartFrameWidth,
      Number.isFinite(style.frameWidth) ? style.frameWidth : 720
    );
    setValueIfPresent(
      elements.assayChartFrameHeight,
      Number.isFinite(style.frameHeight) ? style.frameHeight : 280
    );
    setValueIfPresent(elements.assayChartGridVertical, style.showVerticalGrid !== false);
    setValueIfPresent(elements.assayChartGridHorizontal, style.showHorizontalGrid !== false);
    setValueIfPresent(elements.assayChartGridColor, style.gridColor);
    setValueIfPresent(elements.assayChartGridStrokeWidth, style.gridStrokeWidth);

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
      elements.assayChartFrameWidth.disabled = auto;
    }
    if (elements.assayChartFrameHeight) {
      elements.assayChartFrameHeight.disabled = auto;
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
      pointShape: elements.assayChartPointShape?.value || style.pointShape,
      pointSize: elements.assayChartPointSize
        ? Number(elements.assayChartPointSize.value) || style.pointSize
        : style.pointSize,
      lineStyle: elements.assayChartLineStyle?.value || style.lineStyle,
      curve: elements.assayChartCurve?.value || style.curve,
      lineWidth: elements.assayChartLineWidth
        ? Number(elements.assayChartLineWidth.value) || style.lineWidth
        : style.lineWidth,
      frameStyle: elements.assayChartFrameStyle?.value || style.frameStyle,
      frameStroke: elements.assayChartFrameStroke?.value || style.frameStroke,
      frameStrokeWidth: elements.assayChartFrameStrokeWidth
        ? Number(elements.assayChartFrameStrokeWidth.value)
        : style.frameStrokeWidth,
      frameCornerRadius: elements.assayChartFrameCornerRadius
        ? Number(elements.assayChartFrameCornerRadius.value)
        : style.frameCornerRadius,
      backgroundColor: elements.assayChartBackgroundColor?.value || style.backgroundColor,
      sizeAuto: elements.assayChartSizeAuto
        ? Boolean(elements.assayChartSizeAuto.checked)
        : style.sizeAuto,
      frameWidth: elements.assayChartFrameWidth
        ? Number(elements.assayChartFrameWidth.value) || style.frameWidth
        : style.frameWidth,
      frameHeight: elements.assayChartFrameHeight
        ? Number(elements.assayChartFrameHeight.value) || style.frameHeight
        : style.frameHeight,
      showVerticalGrid: elements.assayChartGridVertical
        ? Boolean(elements.assayChartGridVertical.checked)
        : style.showVerticalGrid,
      showHorizontalGrid: elements.assayChartGridHorizontal
        ? Boolean(elements.assayChartGridHorizontal.checked)
        : style.showHorizontalGrid,
      gridColor: elements.assayChartGridColor?.value || style.gridColor,
      gridStrokeWidth: elements.assayChartGridStrokeWidth
        ? Number(elements.assayChartGridStrokeWidth.value)
        : style.gridStrokeWidth
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

  const inputBindings = [
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
    elements.assayChartPointShape,
    elements.assayChartPointSize,
    elements.assayChartLineStyle,
    elements.assayChartCurve,
    elements.assayChartLineWidth,
    elements.assayChartFrameStyle,
    elements.assayChartFrameStroke,
    elements.assayChartFrameStrokeWidth,
    elements.assayChartFrameCornerRadius,
    elements.assayChartBackgroundColor,
    elements.assayChartSizeAuto,
    elements.assayChartFrameWidth,
    elements.assayChartFrameHeight,
    elements.assayChartGridVertical,
    elements.assayChartGridHorizontal,
    elements.assayChartGridColor,
    elements.assayChartGridStrokeWidth
  ];

  inputBindings.forEach((input) => {
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
      inputBindings.forEach((input) => {
        if (!input) return;
        const event = input.tagName === 'SELECT' || input.type === 'checkbox' ? 'change' : 'input';
        input.removeEventListener(event, onFormInput);
      });
      elements.assayChartStyleResetBtn?.removeEventListener('click', onResetClick);
      clearSeriesColorListeners();
    }
  };
}
