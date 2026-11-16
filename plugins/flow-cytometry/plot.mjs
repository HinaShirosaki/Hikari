import { axisProjection, channelKey } from './analysis.mjs';
import { drawHistogram, histogramAxis } from './histogram.mjs';

const SVG = 'http://www.w3.org/2000/svg';
const COLORS = ['#be405b', '#986bca', '#237d66', '#cc6722', '#426dd4', '#a44494'];
const formatter = new Intl.NumberFormat('en', { maximumSignificantDigits: 4 });
const exponent = new Intl.NumberFormat('en', { maximumSignificantDigits: 3, notation: 'scientific' });
const percent = new Intl.NumberFormat(undefined, { style: 'percent', maximumFractionDigits: 2 });
const axisNumber = value => Math.abs(value) >= 1e6 || (value !== 0 && Math.abs(value) < 0.01)
  ? exponent.format(value) : formatter.format(value);
const clamp = value => Math.max(0, Math.min(1, value));
export const gateColor = index => COLORS[(index - 1) % COLORS.length];
export function channelLabel(channel, aliases) {
  const alias = aliases?.get(channelKey(channel.name));
  if (alias && alias !== channel.name) return `${alias} · ${channel.name}`;
  return alias || (channel.label ? `${channel.name} · ${channel.label}` : channel.name);
}
export const gatePercentage = (count, total) => total > 0 ? percent.format(count / total) : '—';

function svg(tag, attrs, content) {
  const element = document.createElementNS(SVG, tag);
  for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, value);
  if (content !== undefined) element.textContent = content;
  return element;
}

function tickMark(x1, y1, x2, y2) {
  return svg('line', { class: 'axis-tick', x1, y1, x2, y2 });
}

function ticks(axis, limit) {
  const project = axisProjection(axis);
  let values = [];
  if (axis.scale === 'log') {
    const first = Math.ceil(Math.log10(axis.min)), last = Math.floor(Math.log10(axis.max));
    if (last - first >= 1) {
      const step = Math.max(1, Math.ceil((last - first + 1) / limit));
      for (let power = first; power <= last; power += step) values.push(10 ** power);
    }
  } else if (axis.scale === 'linear') {
    const estimate = (axis.max - axis.min) / (limit - 1);
    const base = 10 ** Math.floor(Math.log10(estimate));
    const multiple = [1, 2, 2.5, 5, 10].find(candidate => candidate * base >= estimate);
    const step = multiple * base;
    if (step > 0 && Number.isFinite(step)) {
      const first = Math.ceil(axis.min / step);
      for (let index = 0; index < limit; index++) {
        const value = (first + index) * step;
        if (value > axis.max) break;
        values.push(value);
      }
    }
  }
  if (values.length < 2) values = Array.from({ length: limit }, (_, i) => project.inverse(i / (limit - 1)));
  return values.map(value => [clamp(project.forward(value)), axisNumber(value)]);
}

export function densityPalette() {
  const stops = getComputedStyle(document.documentElement).getPropertyValue('--density-colors');
  const colors = stops.split(',').map(stop => stop.trim().slice(1).match(/.{2}/g).map(hex => parseInt(hex, 16)));
  return Array.from({ length: 256 }, (_, index) => {
    const position = index * (colors.length - 1) / 255;
    const left = Math.min(colors.length - 2, Math.floor(position));
    const weight = position - left;
    return colors[left].map((value, channel) =>
      Math.round(value + weight * (colors[left + 1][channel] - value)));
  });
}

function path(points, closed = true) {
  return points.map(([x, y], index) => `${index ? 'L' : 'M'}${(x * 1000).toFixed(3)} ${((1 - y) * 1000).toFixed(3)}`).join(' ') + (closed ? 'Z' : '');
}

function sameAxis(a, b) {
  return a.scale === b.scale && a.min === b.min && a.max === b.max;
}

function projectCoordinate(value, from, to) {
  if (sameAxis(from, to)) return value;
  const raw = axisProjection(from).inverse(value);
  return to.scale === 'log' && raw <= 0 ? -Infinity : axisProjection(to).forward(raw);
}

function projectOutline(points, gate, x, y) {
  if (sameAxis(gate.x, x) && sameAxis(gate.y, y)) return points;
  const transformX = axisProjection(x).forward, transformY = axisProjection(y).forward;
  const readX = axisProjection(gate.x).inverse, readY = axisProjection(gate.y).inverse;
  const steps = x.scale === gate.x.scale && y.scale === gate.y.scale ? 1 : 12;
  const outline = [];
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i], [x2, y2] = points[(i + 1) % points.length];
    for (let step = 0; step < steps; step++) {
      const t = step / steps;
      const px = transformX(readX(x1 + (x2 - x1) * t));
      const py = transformY(readY(y1 + (y2 - y1) * t));
      // In particular, do not draw a misleading closed polygon through zero
      // when a gate crosses into a region a logarithmic display cannot show.
      if (!Number.isFinite(px) || !Number.isFinite(py)) return [];
      outline.push([Math.max(-1000, Math.min(1001, px)), Math.max(-1000, Math.min(1001, py))]);
    }
  }
  return outline;
}

function circle(center, radius, attrs) {
  return svg('circle', { cx: 1000 * center[0], cy: 1000 * (1 - center[1]), r: 1000 * radius, ...attrs });
}

function partitionPath(kind, [x, y]) {
  const lines = [];
  if (kind !== 'horizontal' && x >= 0 && x <= 1) lines.push(path([[x, 0], [x, 1]], false));
  if (kind !== 'vertical' && y >= 0 && y <= 1) lines.push(path([[0, y], [1, y]], false));
  return lines.join(' ');
}

function partitionLabelCorners(kind, [x, y]) {
  x = clamp(x);
  y = clamp(y);
  if (kind === 'vertical') return [x > 0 ? [x, 1] : null, x < 1 ? [1, 1] : null];
  if (kind === 'horizontal') return [y > 0 ? [1, y] : null, y < 1 ? [1, 1] : null];
  return [
    x > 0 && y < 1 ? [x, 1] : null,
    x < 1 && y < 1 ? [1, 1] : null,
    x > 0 && y > 0 ? [x, y] : null,
    x < 1 && y > 0 ? [1, y] : null
  ];
}

function gateOutline(gate, x, y, attrs) {
  if (gate.threshold) {
    const px = projectCoordinate(gate.threshold[0], gate.x, x);
    const py = projectCoordinate(gate.threshold[1], gate.y, y);
    const d = partitionPath(gate.kind, [px, py]);
    if (!d) return null;
    const corners = partitionLabelCorners(gate.kind, [px, py]);
    return { node: svg('path', { d, ...attrs }), corners, split: [px, py] };
  }
  const exactCircle = gate.center && sameAxis(gate.x, x) && sameAxis(gate.y, y);
  const points = gate.points ?? Array.from({ length: 96 }, (_, index) => {
    const angle = index * 2 * Math.PI / 96;
    return [gate.center[0] + gate.radius * Math.cos(angle), gate.center[1] + gate.radius * Math.sin(angle)];
  });
  const outline = projectOutline(points, gate, x, y);
  if (!outline.length) return null;
  const xs = outline.map(point => point[0]), ys = outline.map(point => point[1]);
  const left = Math.min(...xs), right = Math.max(...xs);
  const bottom = Math.min(...ys), top = Math.max(...ys);
  const visible = left < 1 && right > 0 && bottom < 1 && top > 0;
  const node = exactCircle ? circle(gate.center, gate.radius, attrs) : svg('path', { d: path(outline), ...attrs });
  return { node, corners: visible ? [[clamp(right), clamp(top)]] : [] };
}

function translatedShape(gate, [dx, dy]) {
  const move = ([x, y]) => [x + dx, y + dy];
  if (gate.threshold) {
    return { kind: gate.kind, threshold: move(gate.threshold) };
  }
  if (gate.center) return { kind: gate.kind, center: move(gate.center), radius: gate.radius };
  return { kind: gate.kind, points: gate.points.map(move) };
}

function shapeHandles(gate) {
  if (gate.center) {
    const [x, y] = gate.center;
    const r = gate.radius;
    return [[x + r, y], [x, y + r], [x - r, y], [x, y - r]].map(point => ({ point, mode: 'radius' }));
  }
  if (gate.kind !== 'freehand') return gate.points.map((point, vertex) => ({ point, vertex, mode: 'vertex' }));
  const xs = gate.points.map(([x]) => x), ys = gate.points.map(([, y]) => y);
  const left = Math.min(...xs), right = Math.max(...xs), bottom = Math.min(...ys), top = Math.max(...ys);
  return [
    [[left, top], [right, bottom], 'nwse-resize'], [[right, top], [left, bottom], 'nesw-resize'],
    [[right, bottom], [left, top], 'nwse-resize'], [[left, bottom], [right, top], 'nesw-resize']
  ].map(([point, anchor, cursor]) => ({ point, anchor, cursor, mode: 'bounds' }));
}

function reshape(gate, handle, [dx, dy]) {
  const { kind } = gate;
  const [x, y] = handle.point;
  if (handle.mode === 'radius') {
    const [cx, cy] = gate.center;
    const radius = Math.max(Math.min(gate.radius, .005), Math.hypot(x + dx - cx, y + dy - cy));
    return { kind, center: gate.center, radius };
  }
  if (handle.mode === 'vertex') {
    return { kind, points: gate.points.map((point, index) => index === handle.vertex ? [x + dx, y + dy] : point) };
  }
  const [ax, ay] = handle.anchor;
  const sx = Math.max(.02, 1 + dx / (x - ax)), sy = Math.max(.02, 1 + dy / (y - ay));
  return { kind, points: gate.points.map(([px, py]) => [ax + (px - ax) * sx, ay + (py - ay) * sy]) };
}

function drawGateLabels(context, labels, x0, y0, width, height) {
  const placed = [];
  const elements = [];
  const rowHeight = 14;
  const inset = 6;
  context.save();
  context.font = '700 11px Arial';
  for (const { corner: [right, top], text, color } of labels) {
    const textWidth = context.measureText(text).width;
    const x = Math.min(width - inset, Math.max(textWidth + inset, right * width - inset));
    const left = x - textWidth;
    const bottom = height - 4;
    let y = Math.min(bottom, (1 - top) * height + rowHeight);
    while (y <= bottom && placed.some(label =>
      left < label.right + 3 && x + 3 > label.left && Math.abs(y - label.y) < rowHeight - 0.5
    )) {
      y += rowHeight;
    }
    if (y > bottom) continue;
    placed.push({ left, right: x, y });
    elements.push(svg('text', {
      class: 'gate-percent', x: x0 + x, y: y0 + y,
      'text-anchor': 'end', style: `--gate-label-color: ${color}`
    }, text));
  }
  context.restore();
  return elements;
}

export function createPlot({ chart, area, canvas, axes, overlay, outlines, preview, handles, notice }) {
  overlay.setAttribute('viewBox', '0 0 1000 1000');
  overlay.setAttribute('preserveAspectRatio', 'none');
  const context = canvas.getContext('2d');
  let current;
  let gateLabels = [];
  let splits = [];
  let selection;
  let editHandles = [];
  function drawHandles() {
    editHandles = [];
    const width = overlay.clientWidth;
    if (selection && width) {
      const { gate, split } = selection;
      const color = gateColor(gate.id);
      const splitPoint = split && [
        gate.kind === 'horizontal' ? .5 : split[0],
        gate.kind === 'vertical' ? .5 : split[1]
      ];
      const candidates = split ? [{ mode: gate.kind, display: splitPoint }] : shapeHandles(gate);
      for (const handle of candidates) {
        const point = handle.display ?? [
          projectCoordinate(handle.point[0], gate.x, current.x),
          projectCoordinate(handle.point[1], gate.y, current.y)
        ];
        if (!point.every(value => value >= 0 && value <= 1)) continue;
        editHandles.push({ ...handle, display: point });
      }
      handles.replaceChildren(...editHandles.map((handle, index) => circle(handle.display, 4.5 / width, {
        class: `gate-handle handle-${handle.mode}`, stroke: color, 'data-gate-handle': index,
        'data-gate-id': gate.id, ...(handle.cursor ? { style: `cursor: ${handle.cursor}` } : {})
      })));
    } else handles.replaceChildren();
  }
  const drawAxes = () => {
    if (!current) return;
    const { x, y, channels, counts, smoothing, normalization } = current;
    const chartBounds = chart.getBoundingClientRect();
    const plotBounds = area.getBoundingClientRect();
    const { width, height } = chartBounds;
    const { width: w, height: h } = plotBounds;
    if (!w || !h) return;
    const x0 = plotBounds.left - chartBounds.left;
    const y0 = plotBounds.top - chartBounds.top;
    const bottom = y0 + h;
    const elements = [];
    for (const [fraction, label] of ticks(x, Math.min(8, Math.max(2, Math.floor(w / 70))))) {
      const at = x0 + fraction * w;
      elements.push(tickMark(at, bottom, at, bottom + 5), svg('text', {
        x: at, y: bottom + 18, 'text-anchor': 'middle'
      }, label));
    }
    const yTicks = counts?.ticks ?? ticks(y, Math.min(8, Math.max(2, Math.floor(h / 40))));
    for (const [fraction, label] of yTicks) {
      const at = y0 + (1 - fraction) * h;
      elements.push(tickMark(x0 - 5, at, x0, at), svg('text', { x: x0 - 8, y: at + 4, 'text-anchor': 'end' }, label));
    }
    const nameX = channels[x.channel];
    const histogramLabel = normalization === 'percent' ? '% of in-range events' : smoothing ? 'Smoothed count' : 'Event count';
    const nameY = counts ? histogramLabel : channels[y.channel];
    function label(text, x, y, extra, span) {
      const limit = Math.max(5, Math.floor(span / 7));
      const node = svg('text', { class: 'axis-label', 'text-anchor': 'middle', x, y, ...extra },
        text.length > limit ? text.slice(0, limit - 1) + '…' : text);
      node.append(svg('title', {}, text));
      return node;
    }
    elements.push(
      svg('rect', { class: 'axis-frame', x: x0, y: y0, width: w, height: h }),
      label(nameX, x0 + w / 2, height - 14, {}, w),
      label(nameY, 16, y0 + h / 2, { transform: `rotate(-90 16 ${y0 + h / 2})` }, h)
    );
    elements.push(...drawGateLabels(context, gateLabels, x0, y0, w, h));
    axes.setAttribute('viewBox', `0 0 ${width} ${height}`);
    axes.setAttribute('aria-label', counts ? `Histogram: ${nameX} by ${nameY.toLowerCase()}` : `Event density: ${nameY} versus ${nameX}`);
    axes.replaceChildren(...elements);
  };
  const repaint = () => {
    if (!current) return;
    const { bins, size, peak, counts } = current;
    if (counts) {
      const extent = 1024;
      canvas.width = canvas.height = extent;
      drawHistogram(context, current, counts.max, extent);
      return;
    }
    canvas.width = canvas.height = size;
    if (!peak) return;
    const image = context.createImageData(size, size);
    const colors = densityPalette();
    const scale = peak > 1 ? 255 / Math.log(peak) : 0;
    for (let index = 0; index < bins.length; index++) {
      if (!bins[index]) continue;
      const intensity = Math.min(255, Math.round(Math.log(bins[index]) * scale));
      const color = colors[intensity], at = index * 4;
      image.data[at] = color[0];
      image.data[at + 1] = color[1];
      image.data[at + 2] = color[2];
      image.data[at + 3] = 255;
    }
    context.putImageData(image, 0, 0);
  };
  new ResizeObserver(() => {
    drawAxes();
    drawHandles();
  }).observe(chart);
  return {
    show(result, channels, smoothing = 0, normalization = 'count') {
      const counts = result.histogram ? histogramAxis(result, normalization) : null;
      current = { ...result, channels, smoothing, normalization, counts };
      repaint();
      drawAxes();
      const hasEvents = result.visible || result.series?.some(trace => trace.visible);
      this.message(hasEvents ? '' : 'No events in the current axis ranges.');
    },
    setChannelLabels(channels) {
      if (!current) return;
      current.channels = channels;
      drawAxes();
    },
    setHistogramSmoothing(smoothing) {
      if (!current?.histogram) return;
      current.smoothing = smoothing;
      repaint();
      drawAxes();
    },
    clear() {
      current = null;
      gateLabels = [];
      splits = [];
      selection = null;
      axes.replaceChildren();
      outlines.replaceChildren();
      drawHandles();
      context.clearRect(0, 0, canvas.width, canvas.height);
    },
    message(message) {
      notice.textContent = message;
      notice.hidden = !message;
    },
    gates(gates, active) {
      if (!current || current.histogram) return;
      const { x, y } = current;
      gateLabels = [];
      splits = [];
      selection = null;
      outlines.replaceChildren(...gates.filter(gate => gate.x.channel === x.channel && gate.y.channel === y.channel)
        .flatMap(gate => {
          const color = gateColor(gate.id);
          const classes = ['gate-outline'];
          if (gate.id === active) classes.push('is-active');
          if (gate.threshold) classes.push('is-partition');
          const outline = gateOutline(gate, x, y, { stroke: color, class: classes.join(' '), 'data-gate-id': gate.id });
          if (!outline) return [];
          const { node, corners } = outline;
          if (outline.split) splits.push({ gate, point: outline.split });
          if (gate.id === active && gate.counts && !gate.moving) selection = { gate, split: outline.split };
          if (gate.counts) {
            for (const [index, corner] of corners.entries()) {
              if (!corner) continue;
              gateLabels.push({
                corner, color, active: gate.id === active,
                text: gatePercentage(gate.counts[index], gate.parentCount)
              });
            }
          }
          node.style.setProperty('--gate-color', color);
          node.append(svg('title', {}, gate.name));
          return [node];
        }));
      gateLabels.sort((a, b) => Number(b.active) - Number(a.active));
      drawHandles();
      drawAxes();
    },
    gateAt(event, [px, py]) {
      const handle = event.target.closest?.('[data-gate-handle]');
      if (handle) return { id: Number(handle.dataset.gateId), handle: editHandles[handle.dataset.gateHandle] };
      for (let i = splits.length - 1; i >= 0; i--) {
        const { gate, point: [x, y] } = splits[i];
        const nearX = gate.kind !== 'horizontal' && x >= 0 && x <= 1
          && Math.abs(px - x) * overlay.clientWidth <= 6;
        const nearY = gate.kind !== 'vertical' && y >= 0 && y <= 1
          && Math.abs(py - y) * overlay.clientHeight <= 6;
        if (nearX || nearY) return { id: gate.id, handle: { mode: nearX && nearY ? 'quadrant' : nearX ? 'vertical' : 'horizontal' } };
      }
      const outline = event.target.closest?.('.gate-outline:not(.is-partition)');
      return outline ? { id: Number(outline.dataset.gateId) } : null;
    },
    editShape(gate, start, end, handle) {
      function delta(index, axis, previous) {
        const offset = projectCoordinate(end[index], axis, previous) - projectCoordinate(start[index], axis, previous);
        if (!gate.threshold) return offset;
        const threshold = gate.threshold[index];
        const position = projectCoordinate(threshold, previous, axis);
        if (position < 0 || position > 1) return 0;
        const low = projectCoordinate(0, axis, previous);
        const high = projectCoordinate(1, axis, previous);
        return Math.max(low, Math.min(high, threshold + offset)) - threshold;
      }
      const mode = handle?.mode ?? gate.kind;
      const dx = mode === 'horizontal' ? 0 : delta(0, current.x, gate.x);
      const dy = mode === 'vertical' ? 0 : delta(1, current.y, gate.y);
      if (!Number.isFinite(dx) || !Number.isFinite(dy) || (!dx && !dy)) return null;
      if (handle?.point) return reshape(gate, handle, [dx, dy]);
      return translatedShape(gate, [dx, dy]);
    },
    previewEdit(gate, shape) {
      const outline = shape && gateOutline({ ...gate, ...shape }, current.x, current.y, {
        class: gate.threshold ? 'gate-edit' : 'gate-edit gate-shape',
        style: `--gate-color: ${gateColor(gate.id)}`
      });
      preview.replaceChildren(...(outline ? [outline.node] : []));
    },
    preview(shape) {
      preview.replaceChildren();
      if (!shape) return;
      if (shape.threshold) {
        preview.append(svg('path', { d: partitionPath(shape.kind, shape.threshold) }));
      } else if (shape.center) {
        preview.append(circle(shape.center, shape.radius, { class: 'gate-shape' }));
      } else {
        preview.append(svg('path', { d: path(shape.points, shape.closed), class: shape.closed ? 'gate-shape' : '' }));
        if (shape.start) preview.append(circle(shape.start, 9 / overlay.clientWidth, { class: 'gate-start' }));
      }
    },
    point(event) {
      const box = overlay.getBoundingClientRect();
      if (!box.width || !box.height) return null;
      return [clamp((event.clientX - box.left) / box.width), 1 - clamp((event.clientY - box.top) / box.height)];
    }
  };
}
