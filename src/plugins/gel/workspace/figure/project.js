import { bytesToBase64 } from '../export.js';
import { decodeImageSource } from '../images/image-io.js';
import { normalizeManualOverrides } from '../shared.js';
import { MAX_BLOTS, validatePlacement } from './model.js';
import { normalizeStackTrim } from './trim.js';

export const DRAFT_CONTROL_IDS = [
  'gel-id', 'gel-name', 'gel-type', 'gel-ladder-preset', 'gel-denoise-strength',
  'gel-contrast-strength', 'gel-expected-lane-count'
];

export function serializeBlotProject(rows, title, imageDataToDataUrl, {
  tableSource = 'auto', stackTrim, stackIds = [], checkedIds = rows.map(row => row.id), selectedId = rows[0]?.id, nextLayerNumber = rows.length + 1
} = {}) {
  function packImage(image) {
    return {
      name: image.name, width: image.width, height: image.height,
      png: imageDataToDataUrl(image.imageData), grayBitDepth: image.grayBitDepth,
      grayFloat32: image.grayBitDepth > 8
        ? bytesToBase64(new Uint8Array(image.gray.buffer, image.gray.byteOffset, image.gray.byteLength)) : undefined,
      tiffPageIndex: image.tiffPageIndex, tiffPageCount: image.tiffPageCount
    };
  }
  const tableSourceIndex = rows.findIndex(row => row.id === tableSource);
  const indices = ids => rows.flatMap((row, index) => ids.includes(row.id) ? [index] : []);
  return JSON.stringify({ format: 'hikari-blot-figure', version: 2, title,
    stack: indices(stackIds), checked: indices(checkedIds), nextLayerNumber, stackTrim: normalizeStackTrim(stackTrim),
    view: selectedId === 'stack' ? 'stack' : Math.max(0, rows.findIndex(row => row.id === selectedId)),
    tableSource: tableSourceIndex >= 0 ? tableSourceIndex : tableSource === 'none' ? 'none' : 'auto', rows: rows.map(row => ({
    label: row.label, placement: row.placement,
    draft: {
      controls: row.draft.controls, manualOverrides: row.draft.manualOverrides,
      viewerMode: row.draft.viewerMode, cropApplied: row.draft.cropApplied,
      currentImage: packImage(row.draft.currentImage),
      originalImage: row.draft.cropApplied ? packImage(row.draft.originalImage) : null
    }
  })) });
}

export async function parseBlotProject(content, createId) {
  if (content.length > 180000000) throw new Error('The figure project is too large to open.');
  const project = JSON.parse(content);
  if (project?.format !== 'hikari-blot-figure' || ![1, 2].includes(project.version)
    || !Array.isArray(project.rows) || !project.rows.length || project.rows.length > MAX_BLOTS) {
    throw new Error('Choose a supported Hikari blot figure project.');
  }
  function layerIndices(value, fallback) {
    if (value === undefined) return fallback;
    if (!Array.isArray(value) || value.some(index => !Number.isInteger(index) || index < 0 || index >= project.rows.length)
      || new Set(value).size !== value.length) throw new Error('The project contains an invalid layer selection.');
    return value;
  }
  const allIndices = project.rows.map((_, index) => index);
  const stackTrim = normalizeStackTrim(project.stackTrim);
  const stackIndices = layerIndices(project.stack, project.version === 1 ? allIndices : []);
  const checkedIndices = layerIndices(project.checked, allIndices);
  async function unpackImage(value) {
    if (!value || !/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(value.png || '')
      || !Number.isInteger(value.width) || !Number.isInteger(value.height)
      || value.width < 1 || value.height < 1 || value.width > 1400 || value.height > 1400) {
      throw new Error('The figure project contains an invalid blot image.');
    }
    const image = await decodeImageSource(value.png, String(value.name || 'blot.png'));
    if (image.width !== value.width || image.height !== value.height) throw new Error('Blot image dimensions do not match the project.');
    if (value.grayFloat32) {
      const binary = atob(value.grayFloat32);
      if (binary.length !== image.width * image.height * 4) throw new Error('The blot precision data is incomplete.');
      const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
      const gray = new Float32Array(bytes.buffer);
      if (!gray.every(value => Number.isFinite(value) && value >= 0 && value <= 1)) throw new Error('The blot precision data is invalid.');
      image.gray = gray; image.grayBitDepth = 16;
    }
    image.tiffPageIndex = value.tiffPageIndex;
    image.tiffPageCount = value.tiffPageCount;
    return image;
  }
  const rows = [];
  for (const row of project.rows) {
    const draft = row.draft || {};
    const currentImage = await unpackImage(draft.currentImage);
    const originalImage = draft.originalImage ? await unpackImage(draft.originalImage) : currentImage;
    const controls = Object.fromEntries(DRAFT_CONTROL_IDS.map(id => [id, String(draft.controls?.[id] || '')]));
    controls['gel-id'] = '';
    rows.push({ id: createId(), label: String(row.label || '').slice(0, 120),
      placement: validatePlacement(row.placement),
      draft: { currentImage, originalImage, originalFile: null, controls,
        manualOverrides: normalizeManualOverrides(draft.manualOverrides), currentReport: null,
        viewerMode: draft.viewerMode === 'processed' ? 'processed' : 'original',
        cropApplied: Boolean(draft.cropApplied), pendingNotebookLink: null }
    });
  }
  const tableSource = Number.isInteger(project.tableSource) && rows[project.tableSource]
    ? rows[project.tableSource].id : project.tableSource === 'none' ? 'none' : 'auto';
  const selectedId = project.version === 1 || project.view === 'stack' ? 'stack'
    : Number.isInteger(project.view) && rows[project.view] ? rows[project.view].id : rows[0].id;
  return { rows, tableSource, stackTrim, stackIds: stackIndices.map(index => rows[index].id),
    checkedIds: checkedIndices.map(index => rows[index].id), selectedId,
    nextLayerNumber: Number.isSafeInteger(project.nextLayerNumber) && project.nextLayerNumber > 0 ? project.nextLayerNumber : rows.length + 1,
    title: String(project.title || 'Gel layers').slice(0, 120) };
}
