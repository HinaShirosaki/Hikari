import { normalizePlotElements } from '../../../../shared/assay-plot.mjs';
import { validatePlotElementAxes } from './plot-elements.js';

export function mountPlotElementControls(root, { store, apply, notice }) {
  const element = (tag, text) => {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const fields = {};
  const fieldset = element('fieldset');
  fieldset.className = 'assay-plot-element-fields';
  function field(key, label, type = 'text', options) {
    const wrap = element('label', label);
    if (type === 'checkbox') wrap.className = 'assay-chart-style-checkbox';
    const input = element(options ? 'select' : 'input');
    if (options) options.forEach(([value, title]) => { const option = element('option', title); option.value = value; input.append(option); });
    else { input.type = type; if (type === 'number') input.step = 'any'; }
    input.dataset.plotElement = key;
    input.setAttribute('aria-label', label);
    wrap.append(input); fieldset.append(wrap); fields[key] = input;
    return input;
  }
  field('newType', 'Add plot element', 'text', [['label', 'Label / callout'], ['line', 'Reference line'], ['band', 'Shaded band']]);
  const add = element('button', 'Add element'); add.type = 'button'; add.className = 'ghost-btn'; add.dataset.plotElement = 'add'; fieldset.append(add);
  const selected = field('selected', 'Selected element', 'text', []);
  field('text', 'Label text').maxLength = 500;
  field('coordinates', 'Coordinates', 'text', [['plot', 'Plot position (0–1)'], ['data', 'Data values']]);
  field('x', 'X position'); field('y', 'Y position', 'number');
  field('fontSize', 'Font size (px)', 'number');
  field('arrow', 'Show arrow', 'checkbox');
  field('axis', 'Axis', 'text', [['y', 'Y (horizontal)'], ['x', 'X (vertical)']]);
  field('value', 'Line value', 'number');
  field('start', 'Band start', 'number'); field('end', 'Band end', 'number');
  field('color', 'Element color', 'color');
  field('width', 'Line width (px)', 'number');
  field('dash', 'Line pattern', 'text', [['solid', 'Solid'], ['dash', 'Dashed'], ['dot', 'Dotted']]);
  field('opacity', 'Band opacity', 'number');
  const remove = element('button', 'Remove element'); remove.type = 'button'; remove.className = 'ghost-btn'; remove.dataset.plotElement = 'remove'; fieldset.append(remove);
  const hint = element('p', 'Labels can be dragged on the plot. Lines and bands use data values; on category X axes, use the category index (0, 1, …).');
  hint.className = 'assay-chart-style-note'; root.append(fieldset, hint);
  let selectedId = '';
  let busy = false;
  async function commit(patch, focus) {
    busy = true; fieldset.disabled = true;
    try { await apply(patch); } finally { busy = false; refresh(); }
    focus?.focus();
  }
  function refresh() {
    const items = store.getStyle().plotElements || [];
    if (!items.some((item) => item.id === selectedId)) selectedId = items[0]?.id || '';
    selected.replaceChildren(...items.map((item, index) => {
      const option = element('option', item.type === 'label' ? item.text || `Label ${index + 1}` : `${item.type === 'line' ? 'Line' : 'Band'} · ${item.axis.toUpperCase()} ${item.value ?? `${item.start}–${item.end}`}`);
      option.value = item.id; return option;
    }));
    selected.value = selectedId;
    const item = items.find((entry) => entry.id === selectedId);
    const editable = item ? ['color', ...(item.type === 'label' ? ['text', 'coordinates', 'x', 'y', 'fontSize', 'arrow'] : item.type === 'line' ? ['axis', 'value', 'width', 'dash'] : ['axis', 'start', 'end', 'opacity'])] : [];
    Object.entries(fields).forEach(([key, input]) => {
      if (key === 'newType') return;
      input.closest('label').hidden = key === 'selected' ? !items.length : !editable.includes(key);
      if (key === 'selected') return;
      if (input.type === 'checkbox') input.checked = item?.[key] === true;
      else input.value = item?.[key] ?? '';
    });
    remove.hidden = !item;
    fieldset.disabled = busy || store.getContext().method !== 'agent_plotly';
    hint.textContent = fieldset.disabled ? 'Elements are available for the active agent plot.'
      : 'Labels can be dragged on the plot. Lines and bands use data values; on category X axes, use the category index (0, 1, …).';
    add.disabled = items.length >= 32;
  }
  add.addEventListener('click', () => {
    const type = fields.newType.value;
    const template = type === 'label' ? { text: 'Label', coordinates: 'plot', x: 0.5, y: 0.8 }
      : type === 'line' ? { axis: 'y', value: 1 } : { axis: 'y', start: 1, end: 2 };
    const next = normalizePlotElements([{ id: crypto.randomUUID(), type, ...template }])[0];
    selectedId = next.id;
    void commit({ plotElements: [...store.getStyle().plotElements, next] }, fields[type === 'label' ? 'text' : type === 'line' ? 'value' : 'start']);
  });
  remove.addEventListener('click', () => { void commit({ plotElements: store.getStyle().plotElements.filter((item) => item.id !== selectedId) }, add); });
  fieldset.addEventListener('change', (event) => {
    const key = event.target.dataset.plotElement;
    if (!key || key === 'newType') return;
    if (key === 'selected') { selectedId = selected.value; refresh(); return; }
    const source = store.getStyle().plotElements;
    const item = source.find((entry) => entry.id === selectedId);
    if (!item) return;
    const input = fields[key];
    let value = input.type === 'checkbox' ? input.checked : input.type === 'number' ? (input.value.trim() ? Number(input.value) : NaN) : input.value;
    if (key === 'x' && input.value.trim() && Number.isFinite(Number(input.value))) value = Number(input.value);
    try {
      const next = normalizePlotElements(source.map((entry) => entry.id === selectedId ? { ...entry, [key]: value } : entry));
      const style = store.getStyle();
      validatePlotElementAxes(next, { x: { type: store.getContext().hasCategoryX ? 'category' : style.xScale === 'linear' ? 'linear' : 'log' }, y: { type: style.yScale === 'linear' ? 'linear' : 'log' } });
      void commit({ plotElements: next });
    } catch (error) { notice(error.message); }
  });
  refresh();
  return { refresh };
}
