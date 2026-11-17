import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { inspectPluginFolder } from '../src/main/lib/inspect-plugin-folder.js';
import { makeDemoFcs, parseFcs } from '../plugins/flow-cytometry/fcs.mjs';
import { isEventFileName, readEventFile } from '../plugins/flow-cytometry/event-file.mjs';
import { axesForPlot, initializeFolderAxes, setPlotAxis, storePlotAxes } from '../plugins/flow-cytometry/axis-settings.mjs';
import { histogramAxis } from '../plugins/flow-cytometry/histogram.mjs';
import {
  axisProjection,
  autoRange,
  countGate,
  countPartition,
  defaultAxes,
  eventDensity,
  eventHistogram,
  eventScatter3D,
  gateMembers,
  smoothHistogramBins,
  summarizeChannel
} from '../plugins/flow-cytometry/analysis.mjs';

const pluginUrl = new URL('../plugins/flow-cytometry/', import.meta.url);

test('First-party Flow Cytometry code stays within 200–500 lines per file', async () => {
  async function checkSource(folder) {
    for (const entry of await fs.readdir(folder, { withFileTypes: true })) {
      const url = new URL(entry.name, folder);
      if (entry.isDirectory() && entry.name !== 'vendor') {
        await checkSource(new URL(entry.name + '/', folder));
      } else if (entry.isFile() && /\.(?:[cm]?js|html|css)$/.test(entry.name)) {
        await checkLineCount(url);
      }
    }
  }

  async function checkLineCount(url) {
    const source = await fs.readFile(url, 'utf8');
    const lines = source.replace(/\r?\n$/, '').split(/\r?\n/).length;
    assert.ok(lines >= 200 && lines <= 500, `${fileURLToPath(url)} has ${lines} lines`);
  }

  await checkSource(pluginUrl);
  await checkLineCount(new URL(import.meta.url));
  await checkLineCount(new URL('./flow-cytometry-electron.cjs', import.meta.url));
});

function fixture({ version = '3.1', channelCount = 2, keywords, data, headerData = true, exclusive = false, supplemental = '' }) {
  const encode = string => new TextEncoder().encode(string);
  const field = value => String(value).padStart(8, '0');
  const startText = 128;
  const pairs = `|$PAR|${channelCount}|$MODE|L|$NEXTDATA|0|${keywords}|`;
  const makeText = (start = 0, end = 0, extra = 0, last = 0) => encode(pairs
    + `$BEGINDATA|${field(start)}|$ENDDATA|${field(end)}|$BEGINSTEXT|${field(extra)}|$ENDSTEXT|${field(last)}|`);
  const start = startText + makeText().length;
  const end = start + data.byteLength - 1;
  const extra = encode(supplemental);
  const text = makeText(start, end + Number(exclusive), extra.length ? end + 1 : 0, extra.length ? end + extra.length : 0);
  const header = `FCS${version}    ` + [startText, start - 1, headerData ? start : 0, headerData ? end : 0, 0, 0]
    .map(value => String(value).padStart(8)).join('');
  const bytes = new Uint8Array(end + 1 + extra.length);
  bytes.fill(32, 0, startText);
  bytes.set(encode(header));
  bytes.set(text, startText);
  bytes.set(new Uint8Array(data), start);
  bytes.set(extra, end + 1);
  return bytes.buffer;
}

const axis = (channel, scale, min, max) => ({ channel, scale, min, max });

test('Event imports recognize FCS-compatible LMD and gzip by their contents', async () => {
  const events = makeDemoFcs({ count: 3 });
  const zipped = gzipSync(Buffer.from(events));
  const plain = parseFcs(events);
  for (const file of [
    new File([events], 'sample.LMD'),
    new File([zipped], 'sample.fcs.GZ'),
    new File([zipped], 'sample.gz')
  ]) {
    const { dataset, size } = await readEventFile(file);
    assert.equal(size, events.byteLength);
    assert.equal(dataset.count, 3);
    assert.deepEqual(dataset.channels, plain.channels);
    assert.equal(dataset.reader(2)(1), plain.reader(2)(1));
  }
  assert.equal(isEventFileName('folder/Events.CSV.gz'), true);
  assert.equal(isEventFileName('folder/Sample.LMD'), true);
  assert.equal(isEventFileName('folder/Archive.zip'), false);
  await assert.rejects(readEventFile(new File([zipped], 'sample.fcs.gz'), events.byteLength - 1), /free space/);
  await assert.rejects(readEventFile(new File([zipped.subarray(0, -4)], 'sample.fcs.gz')), /gzip file is damaged/);
  await assert.rejects(readEventFile(new File([events], 'sample.fcs.gz')), /gzip header/);
});

test('CSV imports retain channel names, signed values, and incomplete events', async () => {
  const file = new File(['\uFEFF"FSC-A",SSC-A,"CD19, ""FITC"""\r\n1.5,4,-2e1\r\n2.5,8,\r\n3.5,16,N/A\r\n'], 'sample.CSV');
  const { dataset, size } = await readEventFile(file);
  assert.deepEqual(dataset.channels.map(channel => channel.name), ['FSC-A', 'SSC-A', 'CD19, "FITC"']);
  assert.equal(dataset.count, 3);
  assert.equal(size, 3 * 3 * 8);
  assert.equal(dataset.reader(2)(0), -20);
  assert.ok(Number.isNaN(dataset.reader(2)(1)));
  assert.ok(Number.isNaN(dataset.reader(2)(2)));
  assert.equal(eventDensity(dataset, axis(0, 'linear', 0, 4), axis(1, 'linear', 0, 20)).visible, 3);
  assert.equal(eventDensity(dataset, axis(0, 'linear', 0, 4), axis(2, 'linear', -25, 1)).visible, 1);
});

test('TSV and TXT read headerless data, UTF-16, and compressed event tables', async () => {
  const text = '\uFEFFCD19\tCD20\n0.19\t-600.2\n.044\t7';
  const utf16 = new File([Buffer.from(text, 'utf16le')], 'Markers.TSV');
  const txt = new File([gzipSync('0.19\t-600.2\n.044\t7')], 'Markers.TXT.gz');
  for (const [file, channels] of [[utf16, ['CD19', 'CD20']], [txt, ['Channel 1', 'Channel 2']]]) {
    const { dataset } = await readEventFile(file);
    assert.deepEqual(dataset.channels.map(channel => channel.name), channels);
    assert.equal(dataset.count, 2);
    assert.equal(dataset.reader(0)(0), .19);
    assert.equal(dataset.reader(1)(0), -600.2);
    assert.equal(dataset.reader(0)(1), .044);
    assert.equal(dataset.reader(1)(1), 7);
  }
});

test('Event tables support semicolon exports and access events across storage blocks', async () => {
  const rows = ['FSC-A;SSC-A;CD19', ...Array.from({ length: 4_000 }, (_, index) => index + ';1,5;-2,5')];
  const { dataset } = await readEventFile(new File([rows.join('\r')], 'Markers.csv'));
  assert.equal(dataset.count, 4_000);
  assert.equal(dataset.reader(1)(2730), 1.5);
  assert.equal(dataset.reader(2)(2730), -2.5);
  assert.equal(dataset.reader(0)(3999), 3999);
});

test('Event import rejects malformed tables and bounds their decoded size', async () => {
  await assert.rejects(readEventFile(new File(['CD19,SSC-A\n1,2\n3'], 'ragged.csv')), /Row 3 has 1 columns/);
  await assert.rejects(readEventFile(new File(['CD19,SSC-A\n1,2\n3,marker'], 'text.csv')), /Row 3, column 2 must contain a number/);
  await assert.rejects(readEventFile(new File(['"CD19,SSC-A\n1,2'], 'broken.csv')), /Unclosed quoted field/);
  await assert.rejects(readEventFile(new File(['CD19,SSC-A\n1,'], 'table.csv'), 15), /free space/);
  await assert.rejects(readEventFile(new File(['CD19'], 'empty.txt')), /no numeric events/);
  await assert.rejects(readEventFile(new File(['1,2'], 'workspace.wsp')), /Export the events/);
});

test('Hikari accepts Flow Cytometry with workspace layout and download permissions', async () => {
  const folderPath = fileURLToPath(pluginUrl);
  const plugin = await inspectPluginFolder({ fs, folderPath });
  assert.equal(plugin.ok, true, plugin.error);
  assert.equal(plugin.id, 'flow-cytometry');
  assert.deepEqual(plugin.permissions, ['layout', 'downloads']);
  assert.equal(Boolean(plugin.tool), false);
});

test('FCS 2.0 big-endian integer widths and ADC bit masking', () => {
  const data = Uint8Array.of(0xfc, 0x11, 0x12, 0x34, 0x56, 0, 2, 0, 1, 0).buffer;
  const file = fixture({ version: '2.0', data,
    keywords: '$DATATYPE|I|$BYTEORD|2,1|$TOT|2|$P1B|16|$P1R|1024|$P1N|FSC-A|$P2B|24|$P2R|16777216|$P2N|SSC-A' });
  const dataset = parseFcs(file);
  assert.deepEqual(Array.from({ length: 2 }, (_, index) => [dataset.reader(0)(index), dataset.reader(1)(index)]),
    [[17, 0x123456], [2, 256]]);
});

test('FCS 3.2 mixed float and double, TEXT offsets, escaped labels, and supplemental metadata', () => {
  const data = new ArrayBuffer(24), view = new DataView(data);
  view.setFloat32(0, -7.25, true);
  view.setFloat64(4, 1.1234567890123, true);
  view.setFloat32(12, 9.5, true);
  view.setFloat64(16, -0.03125, true);
  const file = fixture({ version: '3.2', data, headerData: false, exclusive: true,
    keywords: '$DATATYPE|F|$BYTEORD|1,2,3,4|$TOT|2|$P1B|32|$P1N|FL1-A|$P2B|64|$P2DATATYPE|D|$P2N|FL2-A|$P2S|α||β',
    supplemental: '|$CYT|Demo instrument|$P1S|GFP|$P2S|Does not replace the primary label|' });
  const dataset = parseFcs(file);
  assert.equal(dataset.instrument, 'Demo instrument');
  assert.deepEqual(dataset.channels, [{ name: 'FL1-A', label: 'GFP' }, { name: 'FL2-A', label: 'α|β' }]);
  assert.deepEqual([dataset.reader(0)(0), dataset.reader(1)(0), dataset.reader(0)(1), dataset.reader(1)(1)],
    [-7.25, 1.1234567890123, 9.5, -0.03125]);
  assert.throws(() => parseFcs(file.slice(0, -80)), /truncated|offsets|incomplete/i);
  assert.throws(() => parseFcs(new ArrayBuffer(64)), /not a supported FCS/);
});

function spilloverFixture(keywords = '', { version = '3.1', supplemental = '', secondValue = 400 } = {}) {
  // True signals (1000, 200) spill as raw = true · S with S = [[1, .2], [.1, 1]].
  const data = new ArrayBuffer(8), view = new DataView(data);
  view.setFloat32(0, 1020, true);
  view.setFloat32(4, secondValue, true);
  return fixture({
    version, data, supplemental, keywords: '$DATATYPE|F|$BYTEORD|1,2,3,4|$TOT|1|$P1B|32|$P1N|FL1-A|$P2B|32|$P2N|FL2-A'
      + (keywords ? '|' + keywords : '')
  });
}

function expectCompensated(dataset, keyword) {
  assert.deepEqual(dataset.compensation, { applied: true, keyword, channels: 2 });
  assert.ok(Math.abs(dataset.reader(0)(0) - 1000) < 1e-8);
  assert.ok(Math.abs(dataset.reader(1)(0) - 200) < 1e-8);
}

test('FCS spillover keywords compensate in matrix order across FCS versions', () => {
  const matrix = '2, fl2-a , FL1-A, 1, 1e-1, 0.2, 1';
  const variants = [
    ['2.0', 'SPILL'], ['3.0', '$COMP'], ['3.1', '$SPILLOVER'],
    ['3.1', 'SPILLOVER'], ['3.1', 'COMP'], ['3.2', '$SpIlL']
  ];
  for (const [version, keyword] of variants) {
    expectCompensated(parseFcs(spilloverFixture(keyword + '|' + matrix, { version })), keyword.toUpperCase());
  }
  assert.equal(parseFcs(spilloverFixture()).compensation, null);
});

test('FCS spillover accepts unambiguous parameter numbers and stain labels', () => {
  const indexed = parseFcs(fixture({
    version: '3.0', channelCount: 3, data: Float32Array.of(35000, 1020, 400).buffer,
    keywords: '$DATATYPE|F|$BYTEORD|1,2,3,4|$TOT|1|$P1B|32|$P1N|FSC-A|$P2B|32|$P2N|FL1-A|$P3B|32|$P3N|FL2-A'
      + '|$Spillover|2,3,2,1,.1,.2,1'
  }));
  assert.deepEqual(indexed.compensation, { applied: true, keyword: '$SPILLOVER', channels: 2 });
  assert.equal(indexed.reader(0)(0), 35000);
  assert.ok(Math.abs(indexed.reader(1)(0) - 1000) < 1e-8);
  assert.ok(Math.abs(indexed.reader(2)(0) - 200) < 1e-8);
  const labeled = parseFcs(spilloverFixture('$P1S|FITC|$P2S|PE|SPILL|2,pe,FITC,1,.1,.2,1'));
  expectCompensated(labeled, 'SPILL');
  const named = parseFcs(spilloverFixture('$P1S|PE|$P2S|FITC|SPILL|2,FL2-A,FL1-A,1,.1,.2,1'));
  expectCompensated(named, 'SPILL');
});

test('FCS spillover reads supplemental TEXT and uses one valid matrix', () => {
  const file = keywords => parseFcs(spilloverFixture(keywords, { supplemental: '|$SpIlL|2,FL2-A,FL1-A,1,.1,.2,1|' }));
  expectCompensated(file('$SPILLOVER|0'), '$SPILL');
  expectCompensated(file('$SPILLOVER|2,FL1-A,FL2-A,1,.2,.1,1'), '$SPILLOVER');
  const emptyStain = parseFcs(spilloverFixture('$P2S||SPILL|2,FL2-A,FL1-A,1,.1,.2,1'));
  assert.equal(emptyStain.channels[1].label, '');
  expectCompensated(emptyStain, 'SPILL');
});

test('Invalid or ambiguous FCS spillover leaves the recorded values readable', () => {
  const cases = [
    ['$SPILL|2,FL1-A,FL9-A,1,.2,.1,1', /unknown channel: FL9-A/],
    ['$SPILL|2,FL1-A,FL2-A,1,1,1,1', /cannot be inverted/],
    ['$SPILL|2,FL1-A,FL2-A,1,,.1,1', /non-numeric values/],
    ['$SPILL|2,FL1-A,fl1-a,1,.1,.2,1', /more than once/],
    ['$P1S|FITC|$P2S|FITC|$SPILL|2,FITC,FL2-A,1,.1,.2,1', /ambiguous channel: FITC/]
  ];
  for (const [keywords, message] of cases) {
    const dataset = parseFcs(spilloverFixture(keywords));
    assert.equal(dataset.compensation.applied, false);
    assert.equal(dataset.compensation.keyword, '$SPILL');
    assert.match(dataset.compensation.message, message);
    assert.equal(dataset.reader(0)(0), 1020);
  }
});

test('Recorded values are kept for acquisition compensation and a disabled matrix', () => {
  const legacy = [['2.0', '$DFC1TO2', '23'], ['3.0', '$COMP', '2,0,-20,-10,0'], ['3.0', '$COMP', '0,-20,-10,0']];
  for (const [version, keyword, value] of legacy) {
    const dataset = parseFcs(spilloverFixture(keyword + '|' + value, { version }));
    assert.deepEqual(dataset.compensation, { applied: false, keyword, message: 'Legacy acquisition compensation metadata.' });
    assert.equal(dataset.reader(0)(0), 1020);
  }
  const disabled = parseFcs(spilloverFixture('CREATOR|SpectroFlo 3.3|APPLY COMPENSATION|False|$SPILLOVER|2,1,2,1,.2,.1,1'));
  assert.match(disabled.compensation.message, /disabled in the SpectroFlo file/);
  assert.equal(disabled.reader(1)(0), 400);
});

test('FCS spillover skips logarithmic data and keeps nonfinite readings channel-specific', () => {
  const logged = parseFcs(fixture({
    version: '2.0',
    data: Uint8Array.of(6, 4).buffer,
    keywords: '$DATATYPE|I|$BYTEORD|1,2|$TOT|1|$P1B|8|$P1R|256|$P1N|FL1|$P1E|4,1'
      + '|$P2B|8|$P2R|256|$P2N|FL2|$SPILL|2,FL1,FL2,1,.2,.1,1'
  }));
  assert.match(logged.compensation.message, /logarithmically recorded channel/);
  assert.equal(logged.reader(0)(0), 6);
  const identity = parseFcs(spilloverFixture('$SPILL|2,1,2,1,0,0,1', { secondValue: NaN }));
  assert.match(identity.compensation.message, /identity matrix/);
  assert.equal(identity.reader(0)(0), 1020);
  const sparse = parseFcs(spilloverFixture('$SPILL|2,1,2,1,.2,0,1', { secondValue: NaN }));
  assert.equal(sparse.compensation.applied, true);
  assert.equal(sparse.reader(0)(0), 1020);
  assert.ok(Number.isNaN(sparse.reader(1)(0)));
});

test('Density counts all in-range events, with non-positive and nonfinite values excluded only where required', () => {
  const columns = [[-9, 0, 1, 10, 100, Infinity], [1, 1, 1, 1, 1, 1]];
  const dataset = { count: 6, reader: channel => index => columns[channel][index] };
  const y = axis(1, 'linear', 0, 2);
  const log = eventDensity(dataset, axis(0, 'log', 1, 10), y, 4);
  assert.equal(log.visible, 2);
  assert.equal(log.unplottable, 3);
  assert.equal(log.bins.reduce((sum, value) => sum + value, 0), 2);
  const asinh = eventDensity(dataset, axis(0, 'asinh', -9, 100), y, 4);
  assert.equal(asinh.visible, 5);
  assert.equal(asinh.unplottable, 1);
  assert.equal(axisProjection(axis(0, 'asinh', -100, 100)).inverse(.5), 0);
  assert.throws(() => axisProjection(axis(0, 'log', 0, 10)), /positive/);
  assert.throws(() => axisProjection(axis(0, 'linear', 10, 1)), /greater/);
  const [min, max] = autoRange(summarizeChannel(dataset, 0), 'log');
  assert.ok(min > 0 && min < 1 && max > 100);
});

test('Histogram bins use the display scale, include the upper endpoint, and track excluded events', () => {
  const values = [-5, 0, 1, 10, 10, 100, 1000, 10000, 100000, NaN];
  const dataset = { count: values.length, reader: () => index => values[index] };
  const { bins, peak, visible, unplottable } = eventHistogram(dataset, axis(0, 'log', 1, 10000), 32);
  assert.deepEqual([...bins.entries()].filter(([, count]) => count), [[0, 1], [8, 2], [16, 1], [24, 1], [31, 1]]);
  assert.deepEqual({ peak, visible, unplottable }, { peak: 2, visible: 6, unplottable: 3 });
  assert.equal(eventHistogram(dataset, axis(0, 'asinh', -5, 0), 64).visible, 2);
  assert.equal(eventHistogram({ ...dataset, count: 0 }, axis(0, 'linear', 0, 1), 32).peak, 0);
});

test('Histogram smoothing spreads an edge peak without losing events or changing the raw bins', () => {
  const raw = Uint32Array.of(8, 0, 0, 0);
  const light = smoothHistogramBins(raw, 2);
  const strong = smoothHistogramBins(raw, 18);
  assert.deepEqual([...light], [5, 2.5, .5, 0]);
  assert.equal(strong.reduce((sum, count) => sum + count, 0), 8);
  assert.ok(strong[0] < light[0] && strong[3] > 0);
  assert.deepEqual([...raw], [8, 0, 0, 0]);
});

test('Overlay Y scales account for every trace and normalize each source by its own in-range total', () => {
  const result = { peak: 20, visible: 40, series: [{ peak: 400, visible: 4000 }, { peak: 0, visible: 0 }] };
  assert.equal(histogramAxis(result, 'count').max, 400);
  const normalized = histogramAxis(result, 'percent');
  assert.equal(normalized.max, 60);
  assert.deepEqual(normalized.ticks.map(([, label]) => label), ['0%', '20%', '40%', '60%']);
});

test('3D scatter applies all three axis ranges before sampling and counts every in-range event', () => {
  const rows = [[0, 10, 1], [5, 5, 10], [10, 0, 100], [5, 5, 1000], [5, 5, 0], [15, 5, 10], [5, -1, 10]];
  const dataset = { count: rows.length, reader: channel => index => rows[index][channel] };
  const axes = { x: axis(0, 'linear', 0, 10), y: axis(1, 'linear', 0, 10), z: axis(2, 'log', 1, 100) };
  const { points, visible, unplottable } = eventScatter3D(dataset, axes);
  assert.deepEqual([...points], [0, 1, 0, .5, .5, .5, 1, 0, 1]);
  assert.deepEqual({ visible, unplottable }, { visible: 3, unplottable: 1 });
  const sampled = eventScatter3D(dataset, axes, 2);
  assert.equal(sampled.points.length, 6);
  assert.equal(sampled.visible, 3);
  assert.deepEqual(eventScatter3D(dataset, axes, 2), sampled);
});

test('3D scatter colors reflect the full 3D neighborhood even when displayed points are sampled', () => {
  const rows = [[0, 0, 1], [.5, .5, .5], [.52, .5, .5], [0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const dataset = { count: rows.length, reader: channel => index => rows[index][channel] };
  const axes = { x: axis(0, 'linear', 0, 1), y: axis(1, 'linear', 0, 1), z: axis(2, 'linear', 0, 1) };
  const { points, intensities } = eventScatter3D(dataset, axes);
  assert.equal(intensities[0], 0, 'points that overlap in X and Y can have different density');
  assert.ok(intensities[1] > 0 && intensities[1] < 255, 'neighboring cells contribute');
  assert.deepEqual([...intensities.slice(3)], [255, 255, 255]);
  const sampled = eventScatter3D(dataset, axes, 2);
  for (const [index, intensity] of sampled.intensities.entries()) {
    const start = 3 * index;
    const original = rows.findIndex((_, row) =>
      points.subarray(3 * row, 3 * row + 3).every((value, i) => value === sampled.points[start + i]));
    assert.equal(intensity, intensities[original]);
  }
});

test('Freehand gates include boundary events and honor the transform at creation', () => {
  const rows = [[1, 1], [10, 5], [30, 4], [100, 9], [0, 4], [10, 9], [40, 1], [10, 1], [NaN, 4]];
  const dataset = { count: rows.length, reader: channel => index => rows[index][channel] };
  const gate = {
    x: axis(0, 'log', 1, 100), y: axis(1, 'linear', 1, 9),
    points: [[0, 0], [1, 0], [1, 1]]
  };
  assert.equal(countGate(dataset, gate), 6);
  assert.equal(countGate(dataset, { ...gate, x: axis(0, 'linear', 1, 100) }), 4);
});

test('Circle membership uses the original plot scales and includes its edge', () => {
  const rows = [[10, 5], [Math.sqrt(1000), 5], [30, 7], [1, 5], [10, 7.6], [0, 5]];
  const dataset = { count: rows.length, reader: channel => index => rows[index][channel] };
  assert.equal(countGate(dataset, {
    x: axis(0, 'log', 1, 100), y: axis(1, 'linear', 0, 10), center: [.5, .5], radius: .25
  }), 2);
});

test('Splits count all plottable events exactly once, including threshold ties and offscreen events', () => {
  const rows = [[2, 8], [6, 9], [2, 3], [8, 1], [5, 5], [5, 2], [3, 5], [20, 20], [NaN, 5]];
  const dataset = { count: rows.length, reader: channel => index => rows[index][channel] };
  const gate = { x: axis(0, 'linear', 0, 10), y: axis(1, 'linear', 0, 10), threshold: [.5, .5] };
  assert.deepEqual(countPartition(dataset, { ...gate, kind: 'vertical' }), [3, 5]);
  assert.deepEqual(countPartition(dataset, { ...gate, kind: 'horizontal' }), [3, 5]);
  assert.deepEqual(countPartition(dataset, { ...gate, kind: 'quadrant' }), [2, 3, 1, 2]);
});

test('Example data is a valid FCS file, including signed fluorescence values', () => {
  const dataset = parseFcs(makeDemoFcs());
  assert.equal(dataset.count, 16000);
  assert.equal(dataset.channels[2].label, 'GFP');
  assert.ok(summarizeChannel(dataset, 2).min < 0);
});

test('Default axes prefer scatter area and fall back to distinct available channels', () => {
  const cases = [
    { names: ['SSC-A', 'FSC-H', 'FL1-A', 'FSC A'], channels: [3, 0] },
    { names: ['SSC-H', 'FL1-A'], channels: [1, 0] },
    { names: ['FL1-A', 'FL2-A'], channels: [0, 1] },
    { names: ['FL1-A'], channels: [0, 0] }
  ];

  for (const { names, channels } of cases) {
    const { x, y } = defaultAxes(names.map(name => ({ name })));
    assert.deepEqual([x.channel, y.channel], channels, names.join(', '));
    assert.equal(x.scale, 'linear');
    assert.equal(y.scale, 'linear');
    assert.ok(x.auto && y.auto);
  }
});

test('Folder axes carry the scale and range across reordered channels and gated views', () => {
  const folder = {};
  const channels = ['FSC-A', 'SSC-A', 'B525'].map(name => ({ name, label: '' }));
  const first = { id: 1, channels, folder, axes: defaultAxes(channels) };
  const second = { id: 2, channels: [channels[2], channels[0], channels[1]], folder };
  initializeFolderAxes(folder, first);
  setPlotAxis(second, second, 'scatter-3d', null, 'x', { ...axis(1, 'log', 10, 1000), auto: false });
  setPlotAxis(second, second, 'scatter-3d', null, 'z', { ...axis(0, 'asinh', -50, 2000), auto: false });
  const group = { axes: defaultAxes(second.channels) };
  const { x, y, z } = axesForPlot(first, group, 'scatter-3d');
  assert.deepEqual([x.channel, x.scale, x.min, x.max], [0, 'log', 10, 1000]);
  assert.deepEqual([z.channel, z.scale, z.min, z.max], [2, 'asinh', -50, 2000]);
  assert.equal(axesForPlot(first, group, 'histogram').x.channel, 0);
  assert.equal(axesForPlot(second, group, 'density').x.channel, 1);

  const missing = { id: 3, channels: channels.slice(1), folder };
  assert.equal(axesForPlot(missing, missing, 'density').x.channel, -1);
  const preview = { x: { ...axis(0, 'linear', 0, 100), auto: false }, y };
  storePlotAxes(first, group, 'density', preview, preview);
  assert.equal(axesForPlot(first, group, 'density').x.scale, 'log');
});

test('Nested gate members map to the original file rows', () => {
  const rows = [[0, 1], [1, 4], [3, 9], [5, 3], [6, 8], [8, 0], [9, 5]];
  const file = { count: rows.length, reader: channel => index => rows[index][channel] };
  const x = axis(0, 'linear', 0, 10);
  const y = axis(1, 'linear', 0, 10);
  const threshold = [.5, .5];

  const [, right] = gateMembers(file, { kind: 'vertical', x, y, threshold });
  assert.deepEqual([...right], [3, 4, 5, 6]);
  const population = {
    count: right.length,
    reader: channel => index => file.reader(channel)(right[index])
  };

  const [bottom, top] = gateMembers(population, { kind: 'horizontal', x, y, threshold }, right);
  assert.deepEqual([...bottom], [3, 5]);
  assert.deepEqual([...top], [4, 6]);
});
