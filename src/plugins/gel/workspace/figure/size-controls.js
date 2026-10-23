import { blotSizePercent, resizeBlotPlacement } from './model.js';

export function createGelSizeControls({ documentObject, getRows, onResize, onError }) {
  const get = id => documentObject.getElementById(`gel-figure-size${id}`);
  const section = get(''), picker = get('-layer'), input = get('-percent');
  if (!section || !picker || !input) return { render() {}, focus() {}, destroy() {} };
  let selectedId = '';
  let optionsKey = '';
  let renderedValue = '';
  let disabled = false;
  function selected() { return getRows().find(row => row.id === selectedId); }
  function render({ disabled: nextDisabled = disabled } = {}) {
    disabled = nextDisabled;
    const rows = getRows();
    section.hidden = !rows.length;
    if (!rows.some(row => row.id === selectedId)) selectedId = rows[0]?.id || '';
    const key = JSON.stringify(rows.map(row => [row.id, row.label]));
    if (key !== optionsKey) {
      picker.replaceChildren();
      for (const row of rows) {
        const option = documentObject.createElement('option'); option.value = row.id; option.textContent = row.label;
        picker.append(option);
      }
      optionsKey = key;
    }
    picker.value = selectedId;
    picker.closest('label').hidden = rows.length < 2;
    input.disabled = picker.disabled = disabled;
    const row = selected();
    if (row) input.value = renderedValue = String(Math.round(blotSizePercent(row.placement, row.draft.currentImage) * 10) / 10);
  }
  function apply() {
    const row = selected();
    if (!row || disabled || input.value === renderedValue) return;
    try {
      onResize(row, resizeBlotPlacement(row.placement, row.draft.currentImage, Number(input.value)));
      input.setCustomValidity('');
    } catch (error) {
      onError?.(error.message);
      input.setCustomValidity(error.message); input.reportValidity();
    }
    render();
  }
  function changeLayer() { selectedId = picker.value; input.setCustomValidity(''); render(); }
  function onInput() { input.setCustomValidity(''); }
  function onKeyDown(event) {
    if (!['Enter', 'Escape'].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    if (event.key === 'Enter') apply();
    else { input.setCustomValidity(''); render(); }
  }
  picker.addEventListener('change', changeLayer);
  input.addEventListener('change', apply);
  input.addEventListener('input', onInput);
  input.addEventListener('keydown', onKeyDown);
  return {
    render,
    focus(id) { selectedId = id; input.setCustomValidity(''); render(); },
    destroy() {
      picker.removeEventListener('change', changeLayer);
      input.removeEventListener('change', apply);
      input.removeEventListener('input', onInput);
      input.removeEventListener('keydown', onKeyDown);
    }
  };
}
