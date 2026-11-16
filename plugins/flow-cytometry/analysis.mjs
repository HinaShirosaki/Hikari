export const DENSITY_SIZE = 320;
export const HISTOGRAM_BIN_COUNTS = [32, 64, 128, 256];
export const ASINH_COFACTOR = 150;
export const channelKey = name => name.trim().toUpperCase();
const SCATTER_DENSITY_SIZE = 48;
const identity = value => value;
export const SCALES = {
  linear: { forward: identity, inverse: identity },
  log: { forward: Math.log10, inverse: value => 10 ** value },
  asinh: { forward: value => Math.asinh(value / ASINH_COFACTOR), inverse: value => ASINH_COFACTOR * Math.sinh(value) }
};

export function axisProjection({ scale, min, max }) {
  const transform = SCALES[scale];
  const low = transform.forward(min);
  const high = transform.forward(max);
  const span = high - low;
  if (!Number.isFinite(low) || !Number.isFinite(high) || !Number.isFinite(span) || !(span > 0)) {
    throw new Error(scale === 'log'
      ? 'Log ranges need two positive values, with Max greater than Min.'
      : 'Enter finite axis limits with Max greater than Min.');
  }
  return {
    forward: value => (transform.forward(value) - low) / span,
    inverse: fraction => transform.inverse(low + fraction * span)
  };
}

export function summarizeChannel(dataset, channel) {
  const read = dataset.reader(channel);
  let min = Infinity, max = -Infinity, positiveMin = Infinity;
  for (let index = 0; index < dataset.count; index++) {
    const value = read(index);
    if (!Number.isFinite(value)) continue;
    if (value < min) min = value;
    if (value > max) max = value;
    if (value > 0 && value < positiveMin) positiveMin = value;
  }
  return { min, max, positiveMin };
}

export function autoRange(summary, scale) {
  const transform = SCALES[scale];
  const min = scale === 'log' ? summary.positiveMin : summary.min;
  const max = summary.max;
  if (!Number.isFinite(min) || !Number.isFinite(max)) return scale === 'log' ? [1, 10] : [0, 1];
  const lo = transform.forward(min);
  const hi = transform.forward(max);
  const padding = hi === lo
    ? (scale === 'linear' ? Math.max(Math.abs(lo) * 0.08, Number.MIN_VALUE) || 1 : 0.2)
    : (hi - lo) * 0.035;
  if (scale === 'linear' && lo === 0 && hi === 0) return [-1, 1];
  const paddedMin = transform.inverse(lo - padding);
  const paddedMax = transform.inverse(hi + padding);
  return [
    Number.isFinite(paddedMin) && (scale !== 'log' || paddedMin > 0) ? paddedMin : min,
    Number.isFinite(paddedMax) ? paddedMax : max
  ];
}

function coordinates(dataset, x, y) {
  const readX = dataset.reader(x.channel), readY = dataset.reader(y.channel);
  const projectX = axisProjection(x).forward, projectY = axisProjection(y).forward;
  return index => [projectX(readX(index)), projectY(readY(index))];
}

export function eventDensity(dataset, x, y, size = DENSITY_SIZE) {
  const bins = new Uint32Array(size * size);
  const position = coordinates(dataset, x, y);
  let visible = 0, unplottable = 0, peak = 0;
  for (let index = 0; index < dataset.count; index++) {
    const [px, py] = position(index);
    if (!Number.isFinite(px) || !Number.isFinite(py)) {
      unplottable++;
    } else if (px >= 0 && px <= 1 && py >= 0 && py <= 1) {
      const column = Math.min(size - 1, Math.floor(px * size));
      const row = Math.min(size - 1, Math.floor((1 - py) * size));
      const bin = ++bins[row * size + column];
      if (bin > peak) peak = bin;
      visible++;
    }
  }
  return { bins, size, peak, visible, unplottable };
}

function scatterIntensities(counts, pointCells, size) {
  const estimates = new Uint32Array(counts.length);
  const plane = size * size;
  let peak = 0;
  for (let cell = 0; cell < counts.length; cell++) {
    if (!counts[cell]) continue;
    const x = cell % size, y = Math.floor(cell / size) % size, z = Math.floor(cell / plane);
    let sum = 0;
    // Smooth each occupied cell with its 26 neighbors, giving the most
    // weight to events in the same cell.
    for (let k = Math.max(0, z - 1); k <= Math.min(size - 1, z + 1); k++) {
      for (let j = Math.max(0, y - 1); j <= Math.min(size - 1, y + 1); j++) {
        const row = k * plane + j * size;
        const weight = (k === z ? 2 : 1) * (j === y ? 2 : 1);
        for (let i = Math.max(0, x - 1); i <= Math.min(size - 1, x + 1); i++) {
          sum += counts[row + i] * weight * (i === x ? 2 : 1);
        }
      }
    }
    estimates[cell] = sum;
    peak = Math.max(peak, sum);
  }
  // An isolated event has weight 8. As in 2D, use a logarithmic ramp so
  // a dense cluster doesn't compress the rest of the plot into one color.
  const scale = peak > 8 ? 255 / Math.log(peak / 8) : 0;
  return Uint8Array.from(pointCells, cell => Math.round(Math.log(estimates[cell] / 8) * scale));
}

export function eventScatter3D(dataset, { x, y, z }, limit = 30_000) {
  const readX = dataset.reader(x.channel), readY = dataset.reader(y.channel), readZ = dataset.reader(z.channel);
  const projectX = axisProjection(x).forward, projectY = axisProjection(y).forward, projectZ = axisProjection(z).forward;
  const capacity = Math.min(limit, dataset.count);
  const points = new Float32Array(3 * capacity);
  const pointCells = new Uint32Array(capacity);
  const size = SCATTER_DENSITY_SIZE;
  const counts = new Uint32Array(size ** 3);
  const bin = value => Math.min(size - 1, Math.floor(value * size));
  let visible = 0, unplottable = 0, seed = 12345;
  for (let index = 0; index < dataset.count; index++) {
    const px = projectX(readX(index)), py = projectY(readY(index)), pz = projectZ(readZ(index));
    if (!Number.isFinite(px) || !Number.isFinite(py) || !Number.isFinite(pz)) {
      unplottable++;
      continue;
    }
    if (px < 0 || px > 1 || py < 0 || py > 1 || pz < 0 || pz > 1) continue;
    const cell = (bin(pz) * size + bin(py)) * size + bin(px);
    counts[cell]++;
    let slot = visible++;
    if (slot >= limit) {
      // Reservoir sampling gives every in-range event an equal chance, even
      // when the file is sorted by acquisition time.
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      slot = Math.floor(seed / 2 ** 32 * visible);
      if (slot >= limit) continue;
    }
    pointCells[slot] = cell;
    points[3 * slot] = px;
    points[3 * slot + 1] = py;
    points[3 * slot + 2] = pz;
  }
  const displayed = Math.min(visible, capacity);
  const intensities = scatterIntensities(counts, pointCells.subarray(0, displayed), size);
  return { points: points.subarray(0, 3 * displayed), intensities, visible, unplottable };
}

export function eventHistogram(dataset, axis, binCount) {
  if (!HISTOGRAM_BIN_COUNTS.includes(binCount)) throw new Error('Unsupported histogram bin count.');
  const bins = new Uint32Array(binCount);
  const read = dataset.reader(axis.channel);
  const project = axisProjection(axis).forward;
  let visible = 0, unplottable = 0, peak = 0;
  for (let index = 0; index < dataset.count; index++) {
    const position = project(read(index));
    if (!Number.isFinite(position)) {
      unplottable++;
    } else if (position >= 0 && position <= 1) {
      const bin = Math.min(binCount - 1, Math.floor(position * binCount));
      peak = Math.max(peak, ++bins[bin]);
      visible++;
    }
  }
  return { bins, peak, visible, unplottable };
}

export function smoothHistogramBins(bins, passes) {
  if (!passes) return bins;
  let previous = Float64Array.from(bins);
  let next = new Float64Array(bins.length);
  // Blend each bin with its neighbors. Reflect at the edges so no count
  // is lost across the displayed range, even when a peak touches an edge.
  const last = bins.length - 1;
  for (let pass = 0; pass < passes; pass++) {
    for (let index = 0; index <= last; index++) {
      const left = previous[Math.max(0, index - 1)];
      const right = previous[Math.min(last, index + 1)];
      next[index] = (left + 2 * previous[index] + right) / 4;
    }
    [previous, next] = [next, previous];
  }
  return previous;
}

function shapeContains({ points, center, radius }) {
  if (center) {
    const limit = radius ** 2 + 1e-12;
    return (px, py) => (px - center[0]) ** 2 + (py - center[1]) ** 2 <= limit;
  }
  const xs = points.map(point => point[0]), ys = points.map(point => point[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const edges = points.map(([x1, y1], index) => {
    const [x2, y2] = points[(index + 1) % points.length];
    return { x1, y1, dx: x2 - x1, dy: y2 - y1, minX: Math.min(x1, x2),
      maxX: Math.max(x1, x2), minY: Math.min(y1, y2), maxY: Math.max(y1, y2) };
  });
  return (px, py) => {
    if (!(px >= minX && px <= maxX && py >= minY && py <= maxY)) return false;
    let inside = false;
    for (const edge of edges) {
      if (py < edge.minY || py > edge.maxY) continue;
      if (px >= edge.minX && px <= edge.maxX
          && Math.abs((px - edge.x1) * edge.dy - (py - edge.y1) * edge.dx) <= 1e-12) {
        return true;
      }
      if (py < edge.maxY && px < edge.x1 + (py - edge.y1) * edge.dx / edge.dy) inside = !inside;
    }
    return inside;
  };
}

export const PARTITION_REGIONS = {
  vertical: ['Left', 'Right'],
  horizontal: ['Bottom', 'Top'],
  quadrant: ['Upper left', 'Upper right', 'Lower left', 'Lower right']
};

function partitionRegion({ kind, threshold }) {
  return (px, py) => {
    if (!Number.isFinite(px) || !Number.isFinite(py)) return -1;
    // The dividing lines belong to the right or upper region. Each event can
    // land in only one region, including events beyond the visible ranges.
    const right = Number(px >= threshold[0]);
    const above = Number(py >= threshold[1]);
    if (kind === 'vertical') return right;
    if (kind === 'horizontal') return above;
    return 2 * (1 - above) + right;
  };
}

function visitGate(dataset, gate, collect) {
  // Evaluate membership in the coordinates where the gate was drawn.
  const position = coordinates(dataset, gate.x, gate.y);
  const contains = gate.threshold ? null : shapeContains(gate);
  const classify = contains ? (x, y) => contains(x, y) ? 0 : -1 : partitionRegion(gate);
  for (let index = 0; index < dataset.count; index++) {
    const [x, y] = position(index);
    const region = classify(x, y);
    if (region >= 0) collect(region, index);
  }
}

export function countGate(dataset, gate) {
  let count = 0;
  visitGate(dataset, gate, () => count++);
  return count;
}

export function countPartition(dataset, gate) {
  const counts = PARTITION_REGIONS[gate.kind].map(() => 0);
  visitGate(dataset, gate, region => counts[region]++);
  return counts;
}

export function gateMembers(dataset, gate, parentIndices) {
  const regions = Array.from({ length: PARTITION_REGIONS[gate.kind]?.length ?? 1 }, () => ({
    indices: new Uint32Array(Math.min(1024, dataset.count)), count: 0
  }));
  visitGate(dataset, gate, (region, index) => {
    const group = regions[region];
    if (group.count === group.indices.length) {
      const expanded = new Uint32Array(Math.min(dataset.count, group.count * 2));
      expanded.set(group.indices);
      group.indices = expanded;
    }
    group.indices[group.count++] = parentIndices ? parentIndices[index] : index;
  });
  return regions.map(({ indices, count }) => count === indices.length ? indices : indices.slice(0, count));
}

export function defaultAxes(channels) {
  const names = channels.map(channel => channel.name.toUpperCase().replaceAll(' ', '-'));
  function scatter(prefix) {
    const area = names.indexOf(prefix + '-A');
    return area >= 0 ? area : names.findIndex(name => name === prefix || name.startsWith(prefix + '-'));
  }
  const scatterX = scatter('FSC');
  const scatterY = scatter('SSC');
  const x = scatterX >= 0 ? scatterX : scatterY === 0 && channels.length > 1 ? 1 : 0;
  const y = scatterY >= 0 ? scatterY : x === 0 && channels.length > 1 ? 1 : 0;
  return {
    x: { channel: x, scale: 'linear', auto: true },
    y: { channel: y, scale: 'linear', auto: true }
  };
}

export function folderAxisChannel(id, channels, { detector }) {
  if (id === detector.sampleId) return detector.index;
  const key = channelKey(detector.name);
  const matches = channels.flatMap((channel, index) => channelKey(channel.name) === key ? [index] : []);
  if (matches.length === 1) return matches[0];
  const labeled = matches.filter(index => channels[index].label === detector.label);
  return labeled.length === 1 ? labeled[0] : -1;
}

// The worker runs this module directly. The UI imports its axis and gate helpers.
const files = new Map();
const SESSION_FILE_LIMIT = 512 * 1024 * 1024;

function datasetFor(id) {
  const file = files.get(id);
  if (!file) throw new Error('This data file is no longer open.');
  return file;
}

function channelSummary(file, channel) {
  if (!file.summaries.has(channel)) {
    file.summaries.set(channel, summarizeChannel(file.dataset, channel));
  }
  return file.summaries.get(channel);
}

function combinedSummary(sources) {
  const summary = { min: Infinity, max: -Infinity, positiveMin: Infinity };
  for (const { view, channel } of sources) {
    const { min, max, positiveMin } = channelSummary(view, channel);
    summary.min = Math.min(summary.min, min);
    summary.max = Math.max(summary.max, max);
    summary.positiveMin = Math.min(summary.positiveMin, positiveMin);
  }
  return summary;
}

function folderSummary(ids, axis) {
  const sources = [];
  for (const id of ids) {
    const entry = files.get(id);
    if (!entry) continue;
    const channel = folderAxisChannel(id, entry.dataset.channels, axis);
    if (channel >= 0) sources.push({ view: entry, channel });
  }
  return combinedSummary(sources);
}

function resolveAxis(file, axis, folderIds, comparisons = []) {
  const { channel, scale, auto } = axis;
  let { min, max } = axis;
  if (auto) {
    const summary = folderIds ? folderSummary(folderIds, axis)
      : comparisons.length ? combinedSummary([{ view: file, channel }, ...comparisons]) : channelSummary(file, channel);
    [min, max] = autoRange(summary, scale);
  }
  return { channel, scale, auto, min, max };
}

function viewFor(file, group) {
  return group ? file?.groups.get(group.gateId)?.[group.region] : file;
}

function histogramComparison(view, axis, binCount, folderIds, comparisons) {
  const sources = comparisons.flatMap(({ id, group, channel, key }) => {
    const entry = files.get(id);
    const source = viewFor(entry, group);
    return source && entry.dataset.channels[channel] ? [{ key, view: source, channel }] : [];
  });
  const x = resolveAxis(view, axis, folderIds, sources);
  const series = sources.map(({ key, view, channel }) => ({
    key, ...eventHistogram(view.dataset, { ...x, channel }, binCount)
  }));
  return { ...eventHistogram(view.dataset, x, binCount), x, histogram: true, series };
}

function computeGateGroups(entry, view, gate) {
  return gateMembers(view.dataset, gate, view.indices).map(indices => ({
    indices,
    summaries: new Map(),
    dataset: {
      count: indices.length,
      reader(channel) {
        const read = entry.dataset.reader(channel);
        return index => read(indices[index]);
      }
    }
  }));
}

function moveGates(updates) {
  // Stage every affected population before replacing the worker's current
  // groups. Descendants use the newly staged parent in the same sample.
  const staged = updates.map(({ id, gates }) => {
    const entry = datasetFor(id);
    const groups = new Map();
    for (const { gate, group } of gates) {
      const parent = group ? (groups.get(group.gateId) ?? entry.groups.get(group.gateId))?.[group.region] : entry;
      if (!parent) throw new Error('The parent population is no longer available.');
      groups.set(gate.id, computeGateGroups(entry, parent, gate));
    }
    return { entry, groups };
  });
  return staged.map(({ entry, groups }) => [...groups].map(([id, populations]) => {
    entry.groups.set(id, populations);
    return populations.map(({ dataset }) => dataset.count);
  }));
}

async function handle({ action, id, file, axes, gate, group, gateIds, binCount, updates, folderIds, comparisons = [] }) {
  if (action === 'move-gate') return moveGates(updates);
  if (action === 'open') {
    const { readEventFile } = await import('./event-file.mjs');
    let openSize = 0;
    for (const entry of files.values()) openSize += entry.size;
    const { dataset, size } = await readEventFile(file, SESSION_FILE_LIMIT - openSize);
    files.set(id, { dataset, size, summaries: new Map(), groups: new Map() });
    const { version, channels, count, instrument, hasMore, compensation } = dataset;
    return { version, channels, count, instrument, hasMore, compensation };
  }
  if (action === 'close') {
    files.delete(id);
    return null;
  }
  const entry = datasetFor(id);
  if (action === 'remove-gates') {
    for (const gateId of gateIds) entry.groups.delete(gateId);
    return null;
  }
  const view = viewFor(entry, group);
  if (!view) throw new Error('This cell group is no longer open.');
  if (action === 'plot') {
    const x = resolveAxis(view, axes.x, folderIds);
    const y = resolveAxis(view, axes.y, folderIds);
    return { ...eventDensity(view.dataset, x, y), x, y };
  }
  if (action === 'histogram') {
    return histogramComparison(view, axes.x, binCount, folderIds, comparisons);
  }
  if (action === 'scatter-3d') {
    const x = resolveAxis(view, axes.x, folderIds);
    const y = resolveAxis(view, axes.y, folderIds);
    const z = resolveAxis(view, axes.z, folderIds);
    return { ...eventScatter3D(view.dataset, { x, y, z }), x, y, z };
  }
  if (action === 'gate') {
    const groups = computeGateGroups(entry, view, gate);
    entry.groups.set(gate.id, groups);
    return groups.map(({ dataset }) => dataset.count);
  }
  throw new Error('Unknown analysis action.');
}

if (typeof WorkerGlobalScope !== 'undefined' && globalThis instanceof WorkerGlobalScope) {
  // File reads are asynchronous; serialize worker jobs so memory accounting and
  // close/open operations stay in the order issued by the workspace.
  let queue = Promise.resolve();
  self.addEventListener('message', ({ data }) => {
    queue = queue.then(async () => {
      try {
        const result = await handle(data);
        const samples = result?.bins ?? result?.points;
        const transfer = samples ? [samples.buffer] : [];
        if (result?.intensities) transfer.push(result.intensities.buffer);
        for (const series of result?.series ?? []) transfer.push(series.bins.buffer);
        self.postMessage({ request: data.request, result }, transfer);
      } catch (error) {
        self.postMessage({ request: data.request, error: error.message });
      }
    });
  });
}
