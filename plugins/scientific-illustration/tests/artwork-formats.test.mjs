import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { agentInstructions } from '../agent/figure-agent.mjs';
import { EMPTY_PLOT_SVG, alphaBounds, cropRasterPatch, fitRasterBox, normalizePlotly, preparePlots } from '../artwork.mjs';
import { copyComponents, instantiateClipboard } from '../clipboard.mjs';
import { powerPointLayout, powerPointObject, powerPointPaint } from '../figure-export.mjs';
import { applyOperations, createDocument, normalizeDocument, normalizeObject } from '../model.mjs';
import {
  assetContent, compoundGroups, instantiateAsset, normalizeAssetLibrary, snapshotAsset, validateAssetRequest
} from '../reusable-assets.mjs';
import { recolorVector, vectorColors } from '../selection-properties.mjs';

describe('Plotly artwork', () => {
  const figure = () => ({ data: [{ type: 'scatter', x: [0, 1, 2], y: [2, 4, 3] }], layout: { xaxis: { title: { text: 'Time (min)' } } }, source: 'Supplied observations; no normalization.' });
  const object = () => ({ id: 'plot', name: 'Measured response', type: 'plot', x: 25, y: 35, width: 800, height: 500, svg: EMPTY_PLOT_SVG, plotly: figure() });

  test('plots retain canonical data, layout and provenance without adopting raster properties', () => {
    const plot = normalizeObject(object());
    assert.deepEqual(plot.plotly, figure());
    for (const extra of [{ text: 'Baked label' }, { textFree: true }, { dataUrl: 'anything' }, { fill: '#ff0000' }]) assert.throws(() => normalizeObject({ ...object(), ...extra }), /plot property/);
    assert.throws(() => normalizeObject({ id: 'label', type: 'text', plotly: figure() }), /only supported on plot/);
    for (const value of [null, { data: [] }, { data: [null] }, { data: [{}], layout: [] }, { ...figure(), script: 'code' }, { data: [{ x: [Infinity] }] }, { data: [{ y: [NaN] }] }, { data: [{ x: () => 3 }] }]) assert.throws(() => normalizePlotly(value));
  });

  test('plot edits rerender changed sources and sizes, but movement preserves the cached SVG', async () => {
    const before = applyOperations(createDocument(), [{ op: 'upsert', object: object() }]);
    const calls = [];
    const hikari = { call: async (verb, args) => { calls.push({ verb, args }); return { svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${args.width} ${args.height}"><text>Plot labels</text></svg>` }; } };
    const next = applyOperations(before, [{ op: 'update', id: 'plot', patch: { plotly: { ...figure(), data: [{ type: 'bar', y: [3, 5] }] } } }]);
    await preparePlots(next, before, hikari, value => value);
    assert.equal(calls.length, 1); assert.equal(calls[0].verb, 'plotly.render');
    assert.deepEqual(calls[0].args.figure.data[0].y, [3, 5]);
    const moved = applyOperations(next, [{ op: 'update', id: 'plot', patch: { x: 200, y: 100 } }]);
    await preparePlots(moved, next, hikari, value => value); assert.equal(calls.length, 1);
    const resized = applyOperations(moved, [{ op: 'transform', ids: ['plot'], patch: { width: 1600 } }]);
    await preparePlots(resized, moved, hikari, value => value); assert.equal(calls[1].args.width, 1600);
    assert.deepEqual(before.objects[0].plotly, figure());
  });

  test('clipboard and reusable assets keep independently editable plot specifications', () => {
    const document = applyOperations(createDocument(), [{ op: 'upsert', object: object() }]);
    const snapshot = copyComponents(document, ['plot']);
    const pasted = applyOperations(document, instantiateClipboard(snapshot, 'main').operations);
    assert.equal(pasted.objects.length, 2);
    assert.deepEqual(pasted.objects[1].plotly, figure());
    assert.notEqual(pasted.objects[1].id, 'plot');
    const asset = snapshotAsset(document, { id: 'plot', name: 'Measured response' });
    const alternate = structuredClone(asset); alternate.objects[0].svg = '<svg viewBox="0 0 800 500"><defs id="new-plotly-id"/></svg>';
    assert.deepEqual(assetContent(alternate), assetContent(asset));
    const instance = instantiateAsset(asset, { op: 'insert_asset', asset_id: 'plot-asset', canvas: 'main' }, createDocument());
    const inserted = applyOperations(createDocument(), instance.operations);
    assert.deepEqual(inserted.objects[0].plotly, figure());
    assert.match(agentInstructions('standard', 100), /locally vendored Plotly.js/);
    assert.match(agentInstructions('standard', 100), /Never infer an error bar from an average alone/);
  });
});

describe('PowerPoint export', () => {
  test('figure units map uniformly into valid PowerPoint slide dimensions', () => {
    const layout = powerPointLayout({ width: 1200, height: 800 });
    assert.equal(layout.width, 12.5); assert.ok(Math.abs(layout.height - 800 / 96) < 1e-12);
    assert.equal(layout.x, 0); assert.equal(layout.y, 0);
    const large = powerPointLayout({ width: 8000, height: 6000 });
    assert.equal(large.width, 56); assert.equal(large.width / large.height, 4 / 3);
    const narrow = powerPointLayout({ width: 64, height: 8000 });
    assert.equal(narrow.width, 1); assert.equal(narrow.height, 56);
    assert.equal(narrow.x * 2 + 64 * narrow.scale, 1);
    assert.throws(() => powerPointLayout({ width: 0, height: 100 }), /valid canvas/);
  });
  test('native component transforms preserve signed placement, rotation, size, names and opacity', () => {
    const object = { id: 'v', name: 'Membrane & receptor', type: 'vector', x: -32, y: 48, width: 96, height: 144, rotation: -15, opacity: 0.625 };
    const before = structuredClone(object), options = powerPointObject(object, powerPointLayout({ width: 1200, height: 800 }));
    assert.equal(options.x, -1 / 3); assert.equal(options.y, 0.5);
    assert.equal(options.w, 1); assert.equal(options.h, 1.5);
    assert.equal(options.rotate, 345); assert.equal(options.transparency, 37.5);
    assert.equal(options.objectName, object.name); assert.deepEqual(object, before);
  });
  test('labels remain text boxes with figure typography and combined color/layer alpha', () => {
    const object = { id: 'label', type: 'text', text: 'A\nB', fontFamily: '"Inter", Arial', fontSize: 24, fontWeight: 700,
      color: '#11223380', x: 0, y: 0, width: 200, height: 60, rotation: 15, opacity: 0.8,
      italic: true, underline: true, align: 'end', anchor: 'middle' };
    const options = powerPointObject(object, powerPointLayout({ width: 1200, height: 800 }));
    assert.equal(options.fontSize, 18); assert.equal(options.fontFace, 'Inter');
    assert.ok(Math.abs(options.lineSpacing - 21.6) < 1e-12);
    assert.equal(options.align, 'right'); assert.equal(options.valign, 'middle');
    assert.equal(options.bold, true); assert.equal(options.italic, true); assert.equal(options.underline, true);
    assert.equal(options.color, '112233');
    assert.ok(Math.abs(options.transparency - (1 - 128 / 255 * 0.8) * 100) < 1e-10);
    assert.equal(options.isTextBox, true); assert.equal(options.wrap, false); assert.equal(options.margin, 0);
    assert.deepEqual(powerPointPaint('#aabbcc'), { color: 'AABBCC', transparency: 0 });
    assert.throws(() => powerPointPaint('url(https://example.com)'), /hex color/);
  });
});

describe('Raster artwork', () => {
  test('transparent margins are removed without clipping faint edge pixels', () => {
    const pixels = new Uint8ClampedArray(8 * 6 * 4);
    for (let y = 2; y <= 4; y++) for (let x = 3; x <= 5; x++) pixels[(y * 8 + x) * 4 + 3] = 255;
    pixels[(1 * 8 + 2) * 4 + 3] = 1;
    assert.deepEqual(alphaBounds(pixels, 8, 6), { x: 2, y: 1, width: 4, height: 4 });
  });
  test('opaque images retain their full bounds; empty images have no drawable bounds', () => {
    assert.deepEqual(alphaBounds(new Uint8ClampedArray(4 * 3 * 4).fill(255), 4, 3), { x: 0, y: 0, width: 4, height: 3 });
    assert.equal(alphaBounds(new Uint8ClampedArray(16), 2, 2), null);
    assert.throws(() => alphaBounds(new Uint8ClampedArray(4), 2, 2), /Invalid raster/);
  });
  test('cropped raster placement preserves aspect ratio even at object size limits', () => {
    assert.deepEqual(fitRasterBox(34, 21, 102), { width: 102, height: 63 });
    assert.deepEqual(fitRasterBox(34, 21, 1), { width: 34 / 21, height: 1 });
    assert.deepEqual(fitRasterBox(10000, 5000), { width: 8000, height: 4000 });
    assert.throws(() => fitRasterBox(9000, 1), /aspect ratio/);
  });
  test('cropping preserves the world positions of every retained corner on stretched and rotated layers', () => {
    const point = (object, x, y) => {
      const angle = object.rotation * Math.PI / 180, dx = x - object.width / 2, dy = y - object.height / 2;
      return [object.x + object.width / 2 + dx * Math.cos(angle) - dy * Math.sin(angle),
        object.y + object.height / 2 + dx * Math.sin(angle) + dy * Math.cos(angle)];
    };
    for (const rotation of [0, 30, 90, -60, 180]) {
      const object = { x: 70, y: 90, width: 300, height: 150, rotation };
      for (const crop of [{ x: 80, y: 20, width: 160, height: 100 }, { x: 0, y: 0, width: 400, height: 200 }, { x: 300, y: 150, width: 100, height: 50 }]) {
        const next = { ...object, ...cropRasterPatch(object, { width: 400, height: 200 }, crop) };
        for (const [x, y] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
          const expected = point(object, (crop.x + x * crop.width) / 400 * object.width, (crop.y + y * crop.height) / 200 * object.height);
          const actual = point(next, x * next.width, y * next.height);
          assert.ok(actual.every((value, i) => Math.abs(value - expected[i]) < 1e-8));
        }
      }
    }
  });
  test('empty, outside, non-finite, and visually tiny crops fail before updating a layer', () => {
    const object = { x: 0, y: 0, width: 20, height: 10, rotation: 0 }, image = { width: 400, height: 200 };
    for (const crop of [{ x: -1, y: 0, width: 100, height: 100 }, { x: 350, y: 0, width: 100, height: 100 },
      { x: 0, y: 0, width: 0, height: 100 }, { x: NaN, y: 0, width: 100, height: 100 }]) assert.throws(() => cropRasterPatch(object, image, crop), /inside the image/);
    assert.throws(() => cropRasterPatch(object, image, { x: 0, y: 0, width: 1, height: 1 }), /too small/);
  });
  test('direct image saves require exactly one selector and explicit text-free confirmation', () => {
    const args = { action: 'asset_save', illustration_id: 'figure', expected_revision: 'scene', expected_assets_revision: 'library', request_id: 'one', name: 'Organelle', raster_asset: 'image', textFree: true };
    validateAssetRequest(args);
    assert.throws(() => validateAssetRequest({ ...args, textFree: false }), /textFree/);
    assert.throws(() => validateAssetRequest({ ...args, id: 'placed' }), /Save takes/);
  });
  test('raster content identity ignores placement scale but retains rotation and intentional distortion', () => {
    const object = normalizeObject({ id: 'one', type: 'raster', dataUrl: 'data:image/png;base64,AAAA', textFree: true, width: 200, height: 100 });
    const content = value => assetContent({ objects: [value] });
    assert.deepEqual(content(object), content({ ...object, id: 'copy', x: 200, width: 400, height: 200 }));
    assert.notDeepEqual(content(object), content({ ...object, rotation: 45 }));
    assert.notDeepEqual(content(object), content({ ...object, height: 150 }));
  });
  test('compound groups contain multiple artwork layers and keep text separate', () => {
    const doc = createDocument();
    doc.objects = [{ id: 'a', type: 'vector' }, { id: 'b', type: 'raster' }, { id: 'label', type: 'text' }];
    doc.groups = [{ id: 'assembly', ids: ['a', 'b', 'label'] }, { id: 'labeled-part', ids: ['a', 'label'] }];
    assert.deepEqual(compoundGroups(doc).map(group => group.id), ['assembly']);
  });
  test('pending group saves persist in the scene and are pruned when groups disappear', () => {
    const doc = createDocument();
    doc.objects = ['a', 'b'].map(id => ({ id, type: 'text', text: id }));
    doc.groups = [{ id: 'assembly', canvas: 'main', ids: ['a', 'b'] }];
    doc.pendingAssetGroups = ['assembly'];
    assert.deepEqual(normalizeDocument(doc).pendingAssetGroups, ['assembly']);
    assert.deepEqual(normalizeDocument({ ...doc, groups: [] }).pendingAssetGroups, []);
    assert.throws(() => normalizeDocument({ ...doc, pendingAssetGroups: ['assembly', 'assembly'] }), /pending asset groups/);
  });
  test('legacy asset indexes remain readable and automatic saves are not limited to 100 entries', () => {
    const entry = { name: 'Component', width: 20, height: 30, objectCount: 1 };
    assert.equal(normalizeAssetLibrary({ version: 1, revision: 'one', assets: Array.from({ length: 101 }, (_, id) => ({ ...entry, id: `asset-${id}` })) }).assets.length, 101);
    assert.throws(() => normalizeAssetLibrary({ version: 1, revision: 'one', assets: [{ ...entry, id: 'asset', fingerprint: 'bad' }] }), /fingerprint/);
  });
  test('all detail levels require checking reusable assets before generation or edits and saving every output', () => {
    for (const level of ['simple', 'standard', 'detailed']) {
      const instructions = agentInstructions(level);
      assert.match(instructions, /before generating or modifying an illustration, call asset_list/);
      assert.match(instructions, /Save EVERY text-free image_gen output, including unused candidates/);
      assert.match(instructions, /Final inspect automatically saves groups/);
    }
  });
});

describe('Vector colors', () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><defs><linearGradient id="g"><stop offset="0" stop-color="#ABC"/></linearGradient></defs>'
    + '<rect fill="#AABBCC" stroke="#123456" width="4" height="4"/><circle fill="url(#g)" stroke="none" r="2"/><path d="M0 0" fill="white"/></svg>';

  test('swatches list each explicit hex paint once and recolor every use of it', () => {
    const object = { svg };
    assert.deepEqual(vectorColors(object), ['#aabbcc', '#123456']);
    const patch = recolorVector(object, '#aabbcc', '#ff0000');
    assert.deepEqual(Object.keys(patch), ['svg']);
    assert.match(patch.svg, /stop-color="#ff0000".*fill="#ff0000" stroke="#123456"/);
    assert.match(patch.svg, /fill="url\(#g\)".*fill="white"/);
    assert.deepEqual(recolorVector(object, '#000000', '#ff0000'), {});
  });

  test('a layer-wide override replaces its channel of the SVG', () => {
    const object = { svg, fill: '#00FF00', stroke: 'none' };
    assert.deepEqual(vectorColors(object), ['#00ff00', '#aabbcc']);
    assert.deepEqual(recolorVector(object, '#00ff00', '#0000ff'), { fill: '#0000ff' });
    // Only the gradient stop still shows #aabbcc; overridden fills stay untouched.
    const patch = recolorVector(object, '#aabbcc', '#ff0000');
    assert.match(patch.svg, /stop-color="#ff0000".*fill="#AABBCC"/);
  });
});
