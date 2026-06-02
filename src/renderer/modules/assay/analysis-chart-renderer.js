import { summarizeNumeric } from './analysis/shared.js';
import { parseFirstNumericToken } from './shared.js';
import {
  CHART_FONT_FAMILY,
  DEFAULT_CHART_PALETTE
} from './chart-style-model.js';

function parseAnalysisCellNumber(value) {
  return parseFirstNumericToken(value);
}

function pickChartMetricIndex(method, headers, numericIndexes) {
  const methodPriority = {
    grouped_summary: ['mean'],
    nested_summary: ['mean'],
    row_summary: ['mean'],
    column_summary: ['mean'],
    linear_regression: ['r\u00b2', 'r2', 'intercept', 'points'],
    ec50: ['ec50'],
    ic50: ['ic50'],
    survival: ['survival', 'mean'],
    standard_curve_line: ['r\u00b2', 'r2', 'rmse'],
    standard_curve_4pl_log_concentration: ['r\u00b2', 'r2', 'rmse'],
    standard_curve_4pl_concentration: ['r\u00b2', 'r2', 'rmse'],
    standard_curve_5pl_log_concentration: ['r\u00b2', 'r2', 'rmse'],
    standard_curve_5pl_concentration: ['r\u00b2', 'r2', 'rmse'],
    standard_curve_semilog_line: ['r\u00b2', 'r2', 'rmse'],
    standard_curve_hyperbola: ['r\u00b2', 'r2', 'rmse'],
    standard_curve_quadratic: ['r\u00b2', 'r2', 'rmse'],
    standard_curve_cubic: ['r\u00b2', 'r2', 'rmse'],
    standard_curve_pade_11: ['r\u00b2', 'r2', 'rmse']
  };
  const priorities = methodPriority[method] || ['mean', 'value'];
  for (let keywordIndex = 0; keywordIndex < priorities.length; keywordIndex += 1) {
    const keyword = priorities[keywordIndex];
    const match = numericIndexes.find((index) => String(headers[index] || '').toLowerCase().includes(keyword));
    if (Number.isInteger(match)) {
      return match;
    }
  }
  return numericIndexes[0];
}

function resolveColumnIndex(headers, override, fallbackIndex) {
  if (typeof override === 'string' && override && override !== 'auto') {
    const matched = headers.findIndex((header) => String(header) === override);
    if (matched >= 0) {
      return matched;
    }
  }
  return fallbackIndex;
}

function buildAnalysisChartModel(result, method, style) {
  const headers = Array.isArray(result?.headers) ? result.headers : [];
  const rows = Array.isArray(result?.rows) ? result.rows : [];
  if (!headers.length || !rows.length) {
    return null;
  }

  const numericIndexes = headers
    .map((_, index) => index)
    .filter((index) => rows.some((row) => Number.isFinite(parseAnalysisCellNumber(row[index]))));
  if (!numericIndexes.length) {
    return null;
  }

  const autoY = pickChartMetricIndex(method, headers, numericIndexes);
  const yIndex = resolveColumnIndex(headers, style?.yColumn, autoY);
  const otherNumeric = numericIndexes.filter((index) => index !== yIndex);
  const nonNumericIndexes = headers
    .map((_, index) => index)
    .filter((index) => !numericIndexes.includes(index));
  const autoX = nonNumericIndexes[0] ?? otherNumeric[0] ?? null;
  const xIndex = resolveColumnIndex(headers, style?.xColumn, autoX);
  const autoSeries = nonNumericIndexes.find((index) => index !== xIndex) ?? null;
  const seriesIndex = resolveColumnIndex(headers, style?.seriesColumn, autoSeries);
  const seriesMap = new Map();
  let numericXCount = 0;
  let totalCount = 0;

  rows.forEach((row, rowIndex) => {
    const y = parseAnalysisCellNumber(row[yIndex]);
    if (!Number.isFinite(y)) {
      return;
    }
    const rawX = xIndex === null ? rowIndex + 1 : row[xIndex];
    const xLabel = String(rawX ?? '').trim() || `Row ${rowIndex + 1}`;
    const xNumeric = parseAnalysisCellNumber(rawX);
    if (Number.isFinite(xNumeric)) {
      numericXCount += 1;
    }
    const seriesLabel = seriesIndex === null
      ? 'Series'
      : (String(row[seriesIndex] ?? '').trim() || 'Series');
    if (!seriesMap.has(seriesLabel)) {
      seriesMap.set(seriesLabel, []);
    }
    seriesMap.get(seriesLabel).push({ xLabel, xNumeric, y });
    totalCount += 1;
  });

  if (!totalCount || !seriesMap.size) {
    return null;
  }

  const numericXAxis = numericXCount / totalCount >= 0.75;
  const prefersLineMethod = method === 'linear_regression'
    || method === 'ec50'
    || method === 'ic50'
    || method === 'survival'
    || method === 'standard_curve_line'
    || method === 'standard_curve_4pl_log_concentration'
    || method === 'standard_curve_4pl_concentration'
    || method === 'standard_curve_5pl_log_concentration'
    || method === 'standard_curve_5pl_concentration'
    || method === 'standard_curve_semilog_line'
    || method === 'standard_curve_hyperbola'
    || method === 'standard_curve_quadratic'
    || method === 'standard_curve_cubic'
    || method === 'standard_curve_pade_11';
  const chartType = numericXAxis && prefersLineMethod ? 'line' : 'bar';

  if (chartType === 'line') {
    const series = Array.from(seriesMap.entries())
      .map(([label, points]) => {
        const xBuckets = new Map();
        points.forEach((point) => {
          if (!Number.isFinite(point.xNumeric)) {
            return;
          }
          if (!xBuckets.has(point.xNumeric)) {
            xBuckets.set(point.xNumeric, []);
          }
          xBuckets.get(point.xNumeric).push(point.y);
        });
        const data = Array.from(xBuckets.entries())
          .map(([x, values]) => {
            const stats = summarizeNumeric(values);
            return stats ? { x: Number(x), y: stats.mean } : null;
          })
          .filter(Boolean)
          .sort((a, b) => a.x - b.x);
        return { label, data };
      })
      .filter((item) => item.data.length);

    if (!series.length) {
      return null;
    }

    return {
      chartType,
      xLabel: xIndex === null ? 'Row' : String(headers[xIndex] || 'X'),
      yLabel: String(headers[yIndex] || 'Y'),
      series
    };
  }

  const categories = [];
  const categorySet = new Set();
  seriesMap.forEach((points) => {
    points.forEach((point) => {
      if (!categorySet.has(point.xLabel)) {
        categorySet.add(point.xLabel);
        categories.push(point.xLabel);
      }
    });
  });

  const series = Array.from(seriesMap.entries())
    .map(([label, points]) => {
      const categoryValues = new Map();
      points.forEach((point) => {
        if (!categoryValues.has(point.xLabel)) {
          categoryValues.set(point.xLabel, []);
        }
        categoryValues.get(point.xLabel).push(point.y);
      });
      const data = categories
        .map((category) => {
          const values = categoryValues.get(category) || [];
          const stats = summarizeNumeric(values);
          return stats ? { x: category, y: stats.mean } : null;
        })
        .filter(Boolean);
      return { label, data };
    })
    .filter((item) => item.data.length);

  if (!series.length) {
    return null;
  }

  return {
    chartType,
    xLabel: xIndex === null ? 'Row' : String(headers[xIndex] || 'Group'),
    yLabel: String(headers[yIndex] || 'Value'),
    series
  };
}

const LINE_DASH_MAP = {
  solid: '',
  dashed: '6,4',
  dotted: '2,3'
};

function makePointRenderer(ReactLib, shape, color) {
  if (shape === 'triangle') {
    return () => ReactLib.createElement('polygon', {
      points: '0,-1 1,1 -1,1',
      fill: color,
      stroke: color
    });
  }
  if (shape === 'cross') {
    return () => ReactLib.createElement('path', {
      d: 'M-1 0 H1 M0 -1 V1',
      stroke: color,
      strokeWidth: 0.4,
      fill: 'none'
    });
  }
  return null;
}

function pointShapeStringFor(shape) {
  if (shape === 'square' || shape === 'diamond' || shape === 'circle') {
    return shape;
  }
  return null;
}

function pickSeriesColor(style, label, index) {
  const labelKey = String(label || '');
  if (labelKey && style.seriesColors[labelKey]) {
    return style.seriesColors[labelKey];
  }
  const palette = style.palette && style.palette.length ? style.palette : DEFAULT_CHART_PALETTE;
  return palette[index % palette.length];
}

function computeDomain(range, fallbackData, accessor) {
  if (range && range.auto === false
    && Number.isFinite(range.min) && Number.isFinite(range.max)
    && range.min < range.max) {
    return [range.min, range.max];
  }
  if (!Array.isArray(fallbackData) || !fallbackData.length) {
    return null;
  }
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  fallbackData.forEach((point) => {
    const value = accessor(point);
    if (!Number.isFinite(value)) return;
    if (value < min) min = value;
    if (value > max) max = value;
  });
  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) {
    return null;
  }
  return [min, max];
}

function serializeSvgToDataUrl(svgElement) {
  if (!svgElement || String(svgElement.tagName || '').toLowerCase() !== 'svg') {
    return '';
  }
  const clone = svgElement.cloneNode(true);
  if (!clone.getAttribute('xmlns')) {
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  }
  if (!clone.getAttribute('xmlns:xlink')) {
    clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
  }
  const ownerDoc = clone.ownerDocument || document;
  const bg = ownerDoc.createElementNS('http://www.w3.org/2000/svg', 'rect');
  bg.setAttribute('x', '0');
  bg.setAttribute('y', '0');
  bg.setAttribute('width', '100%');
  bg.setAttribute('height', '100%');
  bg.setAttribute('fill', '#ffffff');
  clone.insertBefore(bg, clone.firstChild);
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(clone.outerHTML)}`;
}

export function createAssayAnalysisChartRenderer({
  ReactLib,
  ReactDOMLib,
  ReactVisLib,
  hasReactVis,
  getChartStyle,
  getAnalysisTable
}) {
  let analysisChartHost = null;

  function unmount() {
    if (analysisChartHost && ReactDOMLib?.unmountComponentAtNode) {
      ReactDOMLib.unmountComponentAtNode(analysisChartHost);
    }
    analysisChartHost = null;
  }

  function captureRenderedChartDataUrl() {
    const svg = analysisChartHost?.querySelector?.('svg');
    return serializeSvgToDataUrl(svg);
  }

  function render(result, method) {
    unmount();
    const assayAnalysisTable = getAnalysisTable();
    if (!hasReactVis || !assayAnalysisTable) {
      return { seriesLabels: [] };
    }

    const style = getChartStyle();
    const chartModel = result?.chartModel || buildAnalysisChartModel(result, method, style);
    const chartTarget = assayAnalysisTable.querySelector('[data-assay-analysis-chart]');
    if (!chartModel || !chartTarget) {
      return { seriesLabels: [] };
    }

    const {
      XYPlot,
      XAxis,
      YAxis,
      VerticalGridLines,
      HorizontalGridLines,
      VerticalBarSeries,
      LineSeries,
      MarkSeries,
      CustomSVGSeries,
      WhiskerSeries,
      DiscreteColorLegend
    } = ReactVisLib;
    if (!XYPlot || !XAxis || !YAxis || !VerticalGridLines || !HorizontalGridLines) {
      return { seriesLabels: [] };
    }

    const longestSeries = chartModel.series.reduce((max, item) => Math.max(max, item.data.length), 0);
    const autoWidth = Math.max(420, Math.min(1280, (longestSeries || 1) * (chartModel.chartType === 'line' ? 60 : 70)));
    const autoHeight = 280;
    const useCustomSize = style.sizeAuto === false;
    const plotWidth = useCustomSize && Number.isFinite(style.frameWidth) ? style.frameWidth : autoWidth;
    const plotHeight = useCustomSize && Number.isFinite(style.frameHeight) ? style.frameHeight : autoHeight;
    const marginBottom = chartModel.chartType === 'bar' ? 108 : 72;
    const plotProps = {
      width: plotWidth,
      height: plotHeight,
      margin: { left: 72, right: 24, top: 20, bottom: marginBottom }
    };
    if (chartModel.chartType === 'bar') {
      plotProps.xType = 'ordinal';
    } else {
      const userXScale = style.xScale && style.xScale !== 'auto' ? style.xScale : null;
      if (userXScale && userXScale !== 'ordinal') {
        plotProps.xType = userXScale;
      }
    }
    if (style.yScale && style.yScale !== 'linear') {
      plotProps.yType = style.yScale;
    }

    const allPoints = chartModel.series.flatMap((s) => [
      ...(Array.isArray(s.data) ? s.data : []),
      ...(Array.isArray(s.markers) ? s.markers : [])
    ]);
    if (chartModel.chartType === 'line') {
      const xDomain = computeDomain(style.xRange, allPoints, (p) => p.x);
      if (xDomain) plotProps.xDomain = xDomain;
    }
    const yDomain = computeDomain(style.yRange, allPoints, (p) => p.y);
    if (yDomain) plotProps.yDomain = yDomain;

    const axisColor = style.frameStroke || '#9bb0c9';
    const textStyle = style.text || {};
    const textFontFamily = textStyle.fontFamily
      ? `${textStyle.fontFamily}, ${CHART_FONT_FAMILY}`
      : CHART_FONT_FAMILY;
    const textFill = textStyle.color || axisColor;
    const textFontSize = Number.isFinite(textStyle.fontSize) ? textStyle.fontSize : 11;
    const textFontWeight = textStyle.bold ? 700 : 400;
    const textFontStyle = textStyle.italic ? 'italic' : 'normal';
    const textDecoration = textStyle.underline ? 'underline' : 'none';
    const baselineShift = textStyle.baseline === 'super'
      ? 'super'
      : textStyle.baseline === 'sub' ? 'sub' : 'baseline';
    const textAnchor = textStyle.textAlign || 'middle';
    const svgTextStyle = {
      fill: textFill,
      fontFamily: textFontFamily,
      fontSize: textFontSize,
      fontWeight: textFontWeight,
      fontStyle: textFontStyle,
      textDecoration,
      baselineShift
    };
    const axisLineStyle = {
      line: {
        stroke: axisColor,
        strokeWidth: style.frameStrokeWidth ?? 1
      },
      text: svgTextStyle,
      title: { ...svgTextStyle, textAnchor }
    };

    const gridStyle = {
      stroke: style.gridColor || '#9bb0c9',
      strokeWidth: style.gridStrokeWidth ?? 1
    };

    const plotChildren = [];
    if (style.showVerticalGrid !== false) {
      plotChildren.push(ReactLib.createElement(VerticalGridLines, { key: 'v-grid', style: gridStyle }));
    }
    if (style.showHorizontalGrid !== false) {
      plotChildren.push(ReactLib.createElement(HorizontalGridLines, { key: 'h-grid', style: gridStyle }));
    }
    plotChildren.push(
      ReactLib.createElement(XAxis, {
        key: 'x-axis',
        tickLabelAngle: chartModel.chartType === 'bar' ? -35 : 0,
        style: axisLineStyle
      }),
      ReactLib.createElement(YAxis, {
        key: 'y-axis',
        style: axisLineStyle
      })
    );

    if (style.frameStyle === 'box') {
      plotChildren.push(ReactLib.createElement(XAxis, {
        key: 'x-axis-top',
        orientation: 'top',
        tickFormat: () => '',
        style: axisLineStyle
      }));
      plotChildren.push(ReactLib.createElement(YAxis, {
        key: 'y-axis-right',
        orientation: 'right',
        tickFormat: () => '',
        style: axisLineStyle
      }));
    }

    const dashArray = LINE_DASH_MAP[style.lineStyle] || '';

    chartModel.series.forEach((series, index) => {
      const color = pickSeriesColor(style, series.label, index);
      if (chartModel.chartType === 'line') {
        const hasExplicitMarkers = Array.isArray(series.markers);
        const markerData = hasExplicitMarkers ? series.markers : series.data;
        if (LineSeries && series.data && series.data.length) {
          plotChildren.push(ReactLib.createElement(LineSeries, {
            key: `line-${series.label}-${index}`,
            data: series.data,
            color,
            strokeWidth: style.lineWidth,
            curve: style.curve || 'curveMonotoneX',
            style: dashArray ? { strokeDasharray: dashArray } : undefined
          }));
        }
        const stringShape = pointShapeStringFor(style.pointShape);
        const functionShape = makePointRenderer(ReactLib, style.pointShape, color);
        if (markerData && markerData.length) {
          if (functionShape && CustomSVGSeries) {
            const data = markerData.map((point) => ({
              ...point,
              customComponent: functionShape,
              size: style.pointSize
            }));
            plotChildren.push(ReactLib.createElement(CustomSVGSeries, {
              key: `point-${series.label}-${index}`,
              data,
              color
            }));
          } else if (stringShape && stringShape !== 'circle' && CustomSVGSeries) {
            const data = markerData.map((point) => ({
              ...point,
              customComponent: stringShape,
              size: style.pointSize
            }));
            plotChildren.push(ReactLib.createElement(CustomSVGSeries, {
              key: `point-${series.label}-${index}`,
              data,
              color
            }));
          } else if (MarkSeries) {
            plotChildren.push(ReactLib.createElement(MarkSeries, {
              key: `point-${series.label}-${index}`,
              data: markerData,
              color,
              size: style.pointSize
            }));
          }
        }
      } else if (VerticalBarSeries) {
        plotChildren.push(ReactLib.createElement(VerticalBarSeries, {
          key: `bar-${series.label}-${index}`,
          data: series.data,
          color,
          cluster: 'assay-analysis'
        }));
      }

      if (chartModel.showErrorBars && WhiskerSeries) {
        const whiskerData = series.data.filter((point) => Number.isFinite(point.yVariance) && point.yVariance > 0);
        if (whiskerData.length) {
          plotChildren.push(ReactLib.createElement(WhiskerSeries, {
            key: `whisker-${series.label}-${index}`,
            data: whiskerData,
            color,
            strokeWidth: 1.2,
            crossBarWidth: 8,
            style: { pointerEvents: 'none' }
          }));
        }
      }
    });

    const legendItems = chartModel.series.map((series, index) => ({
      title: series.label,
      color: pickSeriesColor(style, series.label, index)
    }));
    const legendAlign = textStyle.textAlign === 'start'
      ? 'left'
      : textStyle.textAlign === 'end' ? 'right' : 'center';
    const legendVerticalAlign = textStyle.baseline === 'super'
      ? 'super'
      : textStyle.baseline === 'sub' ? 'sub' : 'baseline';
    const legendStyle = {
      fontFamily: textFontFamily,
      fontSize: `${textFontSize}px`,
      color: textFill,
      fontWeight: textFontWeight,
      fontStyle: textFontStyle,
      textDecoration,
      textAlign: legendAlign,
      verticalAlign: legendVerticalAlign
    };
    const legendElement = DiscreteColorLegend && legendItems.length > 1
      ? ReactLib.createElement(DiscreteColorLegend, {
        key: 'legend',
        orientation: 'horizontal',
        items: legendItems,
        style: legendStyle
      })
      : null;

    const canvasClassName = ['assay-analysis-chart-canvas', `frame-${style.frameStyle || 'box'}`].join(' ');
    const canvasStyle = {
      backgroundColor: style.backgroundColor || '#ffffff',
      borderRadius: `${style.frameCornerRadius ?? 0}px`
    };

    const chartContent = [
      ReactLib.createElement('div', { className: 'assay-analysis-chart-plot', key: 'plot' }, [
        ReactLib.createElement(
          'div',
          { className: canvasClassName, style: canvasStyle, key: 'canvas' },
          ReactLib.createElement(XYPlot, { ...plotProps, key: 'xy-plot' }, plotChildren)
        )
      ])
    ];
    if (legendElement) {
      chartContent.unshift(ReactLib.createElement('div', { className: 'assay-analysis-chart-head', key: 'head' }, [
        legendElement
      ]));
    }

    const chartElement = ReactLib.createElement('div', null, chartContent);

    ReactDOMLib.render(chartElement, chartTarget);
    analysisChartHost = chartTarget;
    return {
      seriesLabels: chartModel.series.map((series) => String(series.label || ''))
    };
  }

  return {
    render,
    unmount,
    captureRenderedChartDataUrl
  };
}
