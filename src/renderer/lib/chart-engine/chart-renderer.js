import { CHART_FONT_FAMILY, DEFAULT_CHART_PALETTE } from './chart-style-model.js';

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

// Generic chart renderer: render(target, chartModel, style) -> { seriesLabels }.
// chartModel = { chartType: 'line' | 'bar', xLabel, yLabel, showErrorBars?, series: [{ label, data:[{x,y,yVariance?}], markers? }] }
export function createChartRenderer({ ReactLib, ReactDOMLib, ReactVisLib, hasReactVis }) {
  let chartHost = null;

  function unmount() {
    if (chartHost && ReactDOMLib?.unmountComponentAtNode) {
      ReactDOMLib.unmountComponentAtNode(chartHost);
    }
    chartHost = null;
  }

  function captureDataUrl() {
    const svg = chartHost?.querySelector?.('svg');
    return serializeSvgToDataUrl(svg);
  }

  function render(target, chartModel, style) {
    unmount();
    if (!hasReactVis || !target || !chartModel || !Array.isArray(chartModel.series) || !chartModel.series.length) {
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
          cluster: 'chart-engine'
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

    ReactDOMLib.render(chartElement, target);
    chartHost = target;
    return {
      seriesLabels: chartModel.series.map((series) => String(series.label || ''))
    };
  }

  return { render, unmount, captureDataUrl };
}
