import { blotImageData } from './render.js';

export const STACK_VIEW = 'stack';

export function rowsInStack(rows, stackIds) {
  const members = new Set(stackIds);
  return rows.filter(row => members.has(row.id));
}

function layerThumbnail(row, documentObject) {
  if (!row.thumbnailDataUrl) {
    const image = blotImageData(row);
    const source = documentObject.createElement('canvas');
    source.width = image.width; source.height = image.height;
    source.getContext('2d').putImageData(image, 0, 0);
    const thumbnail = documentObject.createElement('canvas');
    thumbnail.width = 88; thumbnail.height = 52;
    const context = thumbnail.getContext('2d');
    context.fillStyle = '#fff'; context.fillRect(0, 0, 88, 52);
    const scale = Math.min(88 / image.width, 52 / image.height);
    const width = image.width * scale; const height = image.height * scale;
    context.drawImage(source, (88 - width) / 2, (52 - height) / 2, width, height);
    row.thumbnailDataUrl = thumbnail.toDataURL('image/png');
  }
  return row.thumbnailDataUrl;
}

export function renderGelLayers({ list, rows, checkedIds, focusedId, stackIds, documentObject }) {
  list.replaceChildren();
  for (const row of rows) {
    const layer = documentObject.createElement('div'); layer.className = 'gel-figure-layer';
    const checkbox = documentObject.createElement('input'); checkbox.type = 'checkbox';
    checkbox.checked = checkedIds.has(row.id); checkbox.dataset.figureInclude = row.id;
    checkbox.setAttribute('aria-label', `Select ${row.label} for Stack`);
    const button = documentObject.createElement('button'); button.type = 'button'; button.className = 'ghost-btn gel-figure-layer-focus';
    button.dataset.figureRow = row.id; button.setAttribute('aria-pressed', String(row.id === focusedId));
    button.title = 'Select layer. Double-click its name to rename.';
    const thumbnail = documentObject.createElement('img'); thumbnail.alt = ''; thumbnail.src = layerThumbnail(row, documentObject);
    const names = documentObject.createElement('span'); names.className = 'gel-figure-layer-names';
    const name = documentObject.createElement('span'); name.textContent = row.label;
    names.append(name); button.append(thumbnail, names); layer.append(checkbox, button); list.append(layer);
  }
  const stack = documentObject.createElement('button'); stack.type = 'button'; stack.className = 'ghost-btn gel-figure-stack-layer';
  stack.dataset.figureStackView = ''; stack.setAttribute('aria-pressed', String(focusedId === STACK_VIEW));
  const name = documentObject.createElement('span'); name.textContent = 'Stack';
  const count = documentObject.createElement('small');
  const size = rowsInStack(rows, stackIds).length; count.textContent = `${size} gel${size === 1 ? '' : 's'}`;
  stack.append(name, count); list.append(stack);
}
