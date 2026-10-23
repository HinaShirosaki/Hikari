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
  stackTrim, stackIds = [], hasStack = stackIds.length > 0, stackName = 'Stack', layoutName = 'Layout', stacks, activeStackId, checkedIds = rows.map(row => row.id), selectedId = rows[0]?.id, nextLayerNumber = rows.length + 1
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
  const indices = ids => rows.flatMap((row, index) => ids.includes(row.id) ? [index] : []);
  const groups = stacks ?? (hasStack ? [{ id: 'stack', name: stackName, layoutName, layerIds: stackIds, trim: stackTrim }] : []);
  const activeStack = Math.max(0, groups.findIndex(stack => stack.id === activeStackId));
  const current = groups[activeStack];
  return JSON.stringify({ format: 'hikari-blot-figure', version: 4, title,
    stacks: groups.map(stack => ({ id: stack.id, name: stack.name, layoutName: stack.layoutName, layers: indices(stack.layerIds),
      trim: normalizeStackTrim(stack.trim) })), activeStack,
    // Keep the active-stack fields readable by older project tools.
    stack: indices(current?.layerIds ?? stackIds), hasStack: groups.length > 0, stackName: current?.name ?? stackName,
    layoutName: current?.layoutName ?? layoutName, checked: indices(checkedIds), nextLayerNumber,
    stackTrim: normalizeStackTrim(current?.trim ?? stackTrim),
    view: selectedId === 'stack' ? 'stack' : Math.max(0, rows.findIndex(row => row.id === selectedId)),
    rows: rows.map(row => ({
    id: row.id, recordId: row.draft.controls['gel-id'] || row.recordId || '', label: row.label, placement: row.placement,
    draft: {
      controls: { ...row.draft.controls, 'gel-id': '' }, manualOverrides: row.draft.manualOverrides,
      viewerMode: row.draft.viewerMode, cropApplied: row.draft.cropApplied,
      currentReport: row.draft.currentReport, pendingNotebookLink: row.draft.pendingNotebookLink,
      currentImage: packImage(row.draft.currentImage),
      originalImage: row.draft.cropApplied ? packImage(row.draft.originalImage) : null
    }
  })) });
}

export async function parseBlotProject(content, createId, { local = false } = {}) {
  if (content.length > 180000000) throw new Error('The figure project is too large to open.');
  const project = JSON.parse(content);
  if (project?.format !== 'hikari-blot-figure' || ![1, 2, 3, 4].includes(project.version)
    || !Array.isArray(project.rows) || project.rows.length > MAX_BLOTS
    || (!project.rows.length && project.version !== 4 && !(project.version === 2 && project.hasStack === true)
      && !(project.version === 3 && Array.isArray(project.stacks) && project.stacks.length > 0))) {
    throw new Error('Choose a supported Hikari blot figure project.');
  }
  function layerIndices(value, fallback) {
    if (value === undefined) return fallback;
    if (!Array.isArray(value) || value.some(index => !Number.isInteger(index) || index < 0 || index >= project.rows.length)
      || new Set(value).size !== value.length) throw new Error('The project contains an invalid layer selection.');
    return value;
  }
  const allIndices = project.rows.map((_, index) => index);
  const legacyIndices = layerIndices(project.stack, project.version === 1 ? allIndices : []);
  const groups = project.version >= 3 ? project.stacks : legacyIndices.length || project.hasStack === true
    ? [{ name: project.stackName, layoutName: project.layoutName, layers: legacyIndices, trim: project.stackTrim }] : [];
  if (!Array.isArray(groups) || groups.length > 1000 || groups.some(stack => !stack || typeof stack !== 'object')) {
    throw new Error('The project contains an invalid stack list.');
  }
  const assigned = new Set();
  const packedStacks = groups.map(stack => {
    const layers = layerIndices(stack.layers, []);
    if (layers.some(index => assigned.has(index))) throw new Error('A gel cannot belong to more than one stack.');
    layers.forEach(index => assigned.add(index));
    return { ...stack, layers, trim: normalizeStackTrim(stack.trim) };
  });
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
  // Legacy files have no IDs. Derive repeatable identities from the file so
  // opening the same backup twice is idempotent.
  const fileKey = project.version < 4 ? [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content)))].map(value => value.toString(16).padStart(2, '0')).join('') : '';
  const usedIds = new Set();
  function identity(value, fallback) {
    const id = typeof value === 'string' && value.length > 0 && value.length <= 200 ? value : fallback;
    if (usedIds.has(id)) throw new Error('The project contains duplicate identities.');
    usedIds.add(id); return id;
  }
  const rows = [];
  for (const row of project.rows) {
    const draft = row.draft || {};
    const currentImage = await unpackImage(draft.currentImage);
    const originalImage = draft.originalImage ? await unpackImage(draft.originalImage) : currentImage;
    const controls = Object.fromEntries(DRAFT_CONTROL_IDS.map(id => [id, String(draft.controls?.[id] || '')]));
    controls['gel-id'] = local && typeof row.recordId === 'string' ? row.recordId : '';
    rows.push({ id: identity(row.id, fileKey ? `project:${fileKey}:${rows.length}` : createId()), recordId: typeof row.recordId === 'string' ? row.recordId : '', label: String(row.label || '').slice(0, 120),
      placement: validatePlacement(row.placement),
      draft: { currentImage, originalImage, originalFile: null, controls,
        manualOverrides: normalizeManualOverrides(draft.manualOverrides), currentReport: draft.currentReport && typeof draft.currentReport === 'object' ? draft.currentReport : null,
        viewerMode: draft.viewerMode === 'processed' ? 'processed' : 'original',
        cropApplied: Boolean(draft.cropApplied), pendingNotebookLink: draft.pendingNotebookLink && typeof draft.pendingNotebookLink === 'object' ? draft.pendingNotebookLink : null }
    });
  }
  const stacks = packedStacks.map((stack, index) => ({ id: identity(stack.id, fileKey ? `project:${fileKey}:stack:${index}` : `stack-${createId()}`), name: String(stack.name || '').trim().slice(0, 120) || (index ? `Stack ${index + 1}` : 'Stack'),
    layoutName: String(stack.layoutName || '').trim().slice(0, 120) || 'Layout', layerIds: stack.layers.map(index => rows[index].id),
    trim: stack.trim }));
  const active = stacks[Number.isInteger(project.activeStack) ? project.activeStack : 0] || stacks[0];
  const hasStack = stacks.length > 0;
  const stackTrim = active?.trim ?? normalizeStackTrim(project.stackTrim);
  const selectedId = hasStack && (!rows.length || project.version === 1 || project.view === 'stack') ? 'stack'
    : Number.isInteger(project.view) && rows[project.view] ? rows[project.view].id : rows[0]?.id || '';
  return { rows, stacks, activeStackId: active?.id || '', stackTrim, stackIds: active?.layerIds || [], hasStack,
    stackName: active?.name || 'Stack', layoutName: active?.layoutName || 'Layout',
    checkedIds: checkedIndices.map(index => rows[index].id), selectedId,
    nextLayerNumber: Number.isSafeInteger(project.nextLayerNumber) && project.nextLayerNumber > 0 ? project.nextLayerNumber : rows.length + 1,
    title: String(project.title || 'Gel layers').slice(0, 120) };
}
