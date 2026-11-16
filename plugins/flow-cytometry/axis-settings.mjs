import { axisProjection, folderAxisChannel, HISTOGRAM_BIN_COUNTS } from './analysis.mjs';

const $ = id => document.getElementById(id);

function describeAxis(sample, axis) {
  const { channel, ...settings } = axis;
  return { ...settings, detector: { ...sample.channels[channel], sampleId: sample.id, index: channel } };
}

function thirdAxis(sample, x, y) {
  const channel = sample.channels.findIndex((_, index) => index !== x.channel && index !== y.channel);
  return channel >= 0 ? { channel, scale: 'linear', auto: true } : null;
}

export function initializeFolderAxes(folder, sample) {
  if (folder.axes) return;
  const { x, y } = sample.axes;
  const z = thirdAxis(sample, x, y);
  folder.axes = { x: describeAxis(sample, x), y: describeAxis(sample, y) };
  if (z) folder.axes.z = describeAxis(sample, z);
}

export const plotSettings = (sample, view) => sample.folder ?? view;

export function ensurePlotSettings(sample, view, type) {
  const settings = plotSettings(sample, view);
  if (type === 'histogram') {
    settings.histogram ??= { axes: { x: { ...view.axes.x } }, binCount: 128, smoothing: 0 };
  }
  if (type !== 'scatter-3d' || settings.scatter) return;
  if (sample.folder) {
    if (!settings.axes.z) {
      const { x, y } = axesForPlot(sample, view, 'density');
      settings.axes.z = describeAxis(sample, thirdAxis(sample, x, y));
    }
    settings.scatter = { camera: {} };
  } else {
    const x = { ...view.axes.x }, y = { ...view.axes.y };
    if (y.channel === x.channel) {
      const channel = sample.channels.findIndex((_, index) => index !== x.channel);
      Object.assign(y, { channel, auto: true });
    }
    const z = thirdAxis(sample, x, y);
    settings.scatter = { axes: { x, y, z }, camera: {} };
  }
}

function localAxes(view, type) {
  if (type === 'histogram') return view.histogram.axes;
  if (type === 'scatter-3d') return view.scatter.axes;
  return view.axes;
}

export function axesForPlot(sample, view, type, preview) {
  if (preview) return preview;
  if (!sample.folder) return localAxes(view, type);
  const keys = type === 'histogram' ? ['x'] : type === 'scatter-3d' ? ['x', 'y', 'z'] : ['x', 'y'];
  return Object.fromEntries(keys.map(key => {
    const axis = sample.folder.axes[key];
    return [key, { ...axis, channel: folderAxisChannel(sample.id, sample.channels, axis) }];
  }));
}

export function setPlotAxis(sample, view, type, preview, key, axis) {
  if (sample.folder && !preview) sample.folder.axes[key] = describeAxis(sample, axis);
  else (preview ?? localAxes(view, type))[key] = axis;
}

export function storePlotAxes(sample, view, type, preview, result) {
  for (const key of ['x', 'y', 'z']) {
    const axis = result[key];
    if (!axis) continue;
    if (sample.folder && !preview) {
      // Save only the limits. The channel index belongs to this one file.
      Object.assign(sample.folder.axes[key], { min: axis.min, max: axis.max });
    } else {
      (preview ?? localAxes(view, type))[key] = axis;
    }
  }
}

function createAxisEditor(key, changeAxis) {
  const form = $('axis-template').content.firstElementChild.cloneNode(true);
  form.dataset.axis = key;
  form.querySelector('h3').textContent = key.toUpperCase() + ' axis';
  const { channel, scale, min, max, auto } = form.elements;
  const apply = form.querySelector('[type=submit]');
  const alert = form.querySelector('.axis-error');
  let missing = '';
  let rangeEdited = false;

  function error(message = '') {
    alert.textContent = message;
    alert.hidden = !message;
  }

  function setFields(axis) {
    rangeEdited = false;
    channel.value = axis.channel < 0 ? '' : axis.channel;
    scale.value = axis.scale;
    min.value = axis.min ?? '';
    max.value = axis.max ?? '';
    scale.disabled = min.disabled = max.disabled = auto.disabled = apply.disabled = axis.channel < 0;
  }

  function setAuto() {
    if (channel.value === '') return;
    const axis = { channel: Number(channel.value), scale: scale.value, auto: true };
    missing = '';
    channel.querySelector('option[value=""]')?.remove();
    setFields(axis);
    error();
    changeAxis(key, axis);
  }

  for (const field of [channel, scale]) field.addEventListener('change', setAuto);
  auto.addEventListener('click', setAuto);
  form.addEventListener('submit', event => {
    event.preventDefault();
    if (channel.value === '') return;
    const axis = { channel: Number(channel.value), scale: scale.value, min: min.valueAsNumber, max: max.valueAsNumber, auto: false };
    try {
      axisProjection(axis);
    } catch (problem) {
      error(problem.message);
      return;
    }
    rangeEdited = false;
    error();
    changeAxis(key, axis);
  });
  for (const field of [min, max]) field.addEventListener('input', () => {
    rangeEdited = true;
    error();
  });
  $('axis-forms').append(form);

  function setLabels(labels) {
    const value = channel.value;
    const options = labels.map((label, index) => new Option(label, index));
    if (missing) {
      const unavailable = new Option(missing + ' (unavailable)', '');
      unavailable.disabled = true;
      options.unshift(unavailable);
    }
    channel.replaceChildren(...options);
    if (value || missing) channel.value = value;
  }

  return {
    load(labels, axis) {
      form.hidden = !axis;
      if (!axis) return;
      missing = axis.channel < 0 ? axis.detector.name : '';
      setLabels(labels);
      setFields(axis);
      error();
    },
    setLabels,
    update(axis) {
      if (rangeEdited || document.activeElement === min || document.activeElement === max) return;
      min.value = axis.min;
      max.value = axis.max;
    }
  };
}

export function createAxisControls(changeAxis) {
  const editors = {
    x: createAxisEditor('x', changeAxis),
    y: createAxisEditor('y', changeAxis),
    z: createAxisEditor('z', changeAxis)
  };
  const bins = $('histogram-bins');
  const smoothing = $('histogram-smoothing');
  const forms = $('axis-forms');
  const histogramOptions = $('histogram-options');
  bins.replaceChildren(...HISTOGRAM_BIN_COUNTS.map(count => new Option(count, count)));

  return {
    bins,
    smoothing,
    show(axes, labels, type, settings) {
      const histogram = type === 'histogram';
      const scatter = type === 'scatter-3d';
      forms.classList.toggle('is-histogram', histogram);
      forms.classList.toggle('is-scatter-3d', scatter);
      histogramOptions.hidden = !histogram;
      if (histogram) {
        bins.value = settings.histogram.binCount;
        smoothing.value = settings.histogram.smoothing;
      }
      for (const [key, editor] of Object.entries(editors)) editor.load(labels, axes[key]);
    },
    setLabels(labels) {
      for (const editor of Object.values(editors)) editor.setLabels(labels);
    },
    update(axes) {
      for (const [key, editor] of Object.entries(editors)) {
        if (axes[key]) editor.update(axes[key]);
      }
    }
  };
}
