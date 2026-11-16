import { folderAxisChannel, smoothHistogramBins } from './analysis.mjs';

const $ = id => document.getElementById(id);
const SVG = 'http://www.w3.org/2000/svg';
const COLORS = ['#285c9c', '#b44426', '#267550', '#7649a6', '#976600', '#007483'];
const DASHES = [[], [14, 6], [4, 6], [14, 6, 4, 6], [20, 8], [10, 5, 3, 5]];
const formatNumber = new Intl.NumberFormat('en', { maximumSignificantDigits: 4 });
const MAX_COMPARISONS = COLORS.length - 1;

function legendSwatch(index) {
  const swatch = document.createElementNS(SVG, 'svg');
  swatch.setAttribute('class', 'histogram-swatch');
  swatch.setAttribute('aria-hidden', 'true');
  swatch.setAttribute('viewBox', '0 0 23 6');
  const line = document.createElementNS(SVG, 'path');
  line.setAttribute('d', 'M1 3H22');
  line.setAttribute('stroke', COLORS[index]);
  line.setAttribute('stroke-dasharray', DASHES[index].map(length => length / 2).join(' ') || 'none');
  swatch.append(line);
  return swatch;
}

function unit(series, normalization) {
  return normalization === 'percent' && series.visible ? 100 / series.visible : 1;
}

export function histogramAxis(result, normalization) {
  const series = [result, ...(result.series ?? [])];
  const percent = normalization === 'percent';
  const peak = Math.max(...series.map(trace => trace.peak * unit(trace, normalization)));
  const target = Math.max(percent ? .01 : 1, peak) / 4;
  const base = 10 ** Math.floor(Math.log10(target));
  const step = Math.max(percent ? 0 : 1, [1, 2, 5, 10].find(multiplier => multiplier * base >= target) * base);
  const intervals = Math.max(1, Math.ceil(peak / step));
  const ticks = Array.from({ length: intervals + 1 }, (_, index) => [
    index / intervals, formatNumber.format(index * step) + (percent ? '%' : '')
  ]);
  return { max: intervals * step, ticks };
}

function drawBars(context, bins, scale, extent) {
  const width = extent / bins.length;
  context.fillStyle = COLORS[0];
  for (const [index, count] of bins.entries()) {
    if (!count) continue;
    const height = Math.max(1, Math.round(count * scale));
    context.fillRect(index * width, extent - height, width, height);
  }
}

function tracePath(context, bins, scale, extent, smoothing) {
  const width = extent / bins.length;
  const y = count => extent - count * scale;
  context.beginPath();
  context.moveTo(0, y(bins[0]));
  for (const [index, count] of bins.entries()) {
    if (smoothing) context.lineTo((index + .5) * width, y(count));
    else {
      context.lineTo(index * width, y(count));
      context.lineTo((index + 1) * width, y(count));
    }
  }
  if (smoothing) context.lineTo(extent, y(bins.at(-1)));
}

export function drawHistogram(context, result, max, extent) {
  const { smoothing, normalization, series = [] } = result;
  if (!series.length && !smoothing) {
    drawBars(context, result.bins, extent * unit(result, normalization) / max, extent);
    return;
  }
  context.save();
  context.lineWidth = 4;
  context.lineJoin = 'round';
  for (const [index, trace] of [result, ...series].entries()) {
    if (!trace.visible) continue;
    const bins = smoothHistogramBins(trace.bins, smoothing);
    tracePath(context, bins, extent * unit(trace, normalization) / max, extent, smoothing);
    context.strokeStyle = COLORS[index];
    context.setLineDash(DASHES[index]);
    context.stroke();
    if (!series.length) {
      context.lineTo(extent, extent);
      context.lineTo(0, extent);
      context.closePath();
      context.fillStyle = COLORS[0] + '30';
      context.fill();
    }
  }
  context.restore();
}

function sourceKey(sample, view) {
  return view.gate ? `${sample.id}:${view.gate.id}:${view.region}` : String(sample.id);
}

function detectorFor(sample, axis) {
  return axis.detector ?? { ...sample.channels[axis.channel], sampleId: sample.id, index: axis.channel };
}

export function createHistogramOverlay({ listSamples, groupName, groupReference, onChange }) {
  const settings = new WeakMap();
  const dialog = $('histogram-overlay-dialog');
  const list = $('histogram-overlay-list');
  const normalization = $('histogram-normalization');
  const legend = $('histogram-legend');
  const footer = $('histogram-footer');
  const unavailable = $('histogram-unavailable');
  let editing = null;

  function sources(sample, axis) {
    const detector = detectorFor(sample, axis);
    return [...listSamples()].map(file => {
      const channel = folderAxisChannel(file.id, file.channels, { detector });
      const name = [file.folder?.name, file.name].filter(Boolean).join(' / ');
      const traceName = file.folder === sample.folder ? file.name : name;
      function descendants(view, path = []) {
        const items = [{ key: sourceKey(file, view), id: file.id, group: groupReference(view),
          channel, name: [traceName, ...path].join(' / '), label: path.at(-1) ?? 'All events', depth: path.length }];
        for (const gate of view.gates) {
          if (!gate.counts) continue;
          for (const group of gate.groups) items.push(...descendants(group, [...path, groupName(group)]));
        }
        return items;
      }
      return { name, items: descendants(file) };
    });
  }

  function updateChoices() {
    const choices = [...list.querySelectorAll('input')];
    const selected = choices.filter(input => input.checked && input.value !== editing.base).length;
    for (const input of choices) {
      input.disabled = input.value === editing.base || (!input.checked && (
        input.dataset.unavailable === 'true' || selected >= MAX_COMPARISONS
      ));
    }
  }

  function choice(item, base, selected) {
    const row = document.createElement('label');
    row.className = 'histogram-source';
    row.style.setProperty('--group-depth', Math.min(item.depth, 4));
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.value = item.key;
    input.checked = item.key === base || selected.has(item.key);
    input.dataset.unavailable = String(item.channel < 0);
    const label = document.createElement('span');
    label.textContent = item.label;
    if (item.key === base) label.append(' (current)');
    else if (item.channel < 0) label.append(' (channel unavailable)');
    row.append(input, label);
    return row;
  }

  list.addEventListener('change', updateChoices);
  $('cancel-histogram-overlay').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
    if (!dialog.open) editing = null;
  });
  $('histogram-overlay-form').addEventListener('submit', event => {
    event.preventDefault();
    if (!editing) return;
    const { view, base } = editing;
    const selected = [...list.querySelectorAll('input:checked')].map(input => input.value).filter(key => key !== base);
    settings.set(view, { selected: new Set(selected.slice(0, MAX_COMPARISONS)), normalization: normalization.value });
    dialog.close();
    onChange(view);
  });

  return {
    open(sample, view, axis) {
      const base = sourceKey(sample, view);
      const config = settings.get(view);
      const selected = config?.selected ?? new Set();
      editing = { view, base };
      normalization.value = config?.normalization ?? 'count';
      list.replaceChildren(...sources(sample, axis).map(({ name, items }) => {
        const field = document.createElement('fieldset');
        const title = document.createElement('legend');
        title.textContent = name;
        field.append(title, ...items.map(item => choice(item, base, selected)));
        return field;
      }));
      updateChoices();
      dialog.showModal();
    },
    includes(view, { sampleId, gateIds }) {
      for (const key of settings.get(view)?.selected ?? []) {
        const [file, gate] = key.split(':').map(Number);
        if (sampleId === file || gateIds?.has(gate)) return true;
      }
      return false;
    },
    prepare(sample, view, axis) {
      const config = settings.get(view);
      const comparisons = [], skipped = [], labels = new Map();
      if (config?.selected.size) {
        const saved = [];
        for (const { items } of sources(sample, axis)) {
          for (const item of items) {
            if (!config.selected.has(item.key)) continue;
            saved.push(item.key);
            if (item.channel < 0) skipped.push(item.name);
            else {
              const { id, group, channel, key } = item;
              comparisons.push({ id, group, channel, key });
              labels.set(key, item.name);
            }
          }
        }
        config.selected = new Set(saved);
      }
      const path = [];
      for (let group = view; group.gate; group = group.gate.view) path.unshift(groupName(group));
      const base = [sample.name, ...path].join(' / ');
      return { base, comparisons, skipped, labels, normalization: config?.normalization ?? 'count' };
    },
    show(comparison, result) {
      const { base, skipped, labels } = comparison;
      const series = result.series ?? [];
      legend.replaceChildren(...(series.length ? [result, ...series].map((trace, index) => {
        const item = document.createElement('li');
        const name = index ? labels.get(trace.key) : base;
        item.append(legendSwatch(index), trace.visible ? name : name + ' (no events in range)');
        return item;
      }) : []));
      unavailable.textContent = skipped.length ? `Channel unavailable in ${skipped.join(', ')}.` : '';
      unavailable.hidden = !skipped.length;
      footer.hidden = !series.length && !skipped.length;
    },
    clear() {
      footer.hidden = true;
      legend.replaceChildren();
      unavailable.textContent = '';
      unavailable.hidden = true;
    }
  };
}
