import { createChartStylePicker, SHAPE_OPTIONS, LINE_STYLE_OPTIONS, FRAME_STYLE_OPTIONS } from './chart-style-pickers.js';
import { createChartTextControls } from './chart-text-controls.js';
import { deleteChartPreset, getChartPreset, listChartPresets, sanitizePresetName, saveChartPreset, FIGURE_CLASSIC_PRESET } from './chart-presets.js';
import { PANEL_HTML, TABS, TAB_KEYS } from './chart-controls-markup.js';
import { createChartControlsForm, GLOBAL_FIELDS, SERIES_FIELDS, POINT_FIELDS, AXIS_FIELDS, axisStyleKey } from './chart-controls-form.js';
import { pointsToPixels } from './chart-style-model.js';
import { axisStylePatch, seriesStylePatch, validateAxisRange, figureClassicPatch } from './chart-style-targets.js';

export function mountChartControls(container, { store, promptForName } = {}) {
  if (!container || !store) return { refresh() {}, destroy() {} };
  const askName = promptForName || ((message, initial) => globalThis.prompt?.(message, initial));
  container.innerHTML = PANEL_HTML;
  const q = (key) => container.querySelector(`[data-cc="${key}"]`);
  const selection = { series: null, text: 'title', customTick: {} };
  let activeTab = 'frame';
  let refreshing = false;
  let form;
  function notice(message = '') {
    q('validation').textContent = message;
    q('validation').hidden = !message;
  }
  function apply(patch) {
    notice();
    store.setStyle(patch);
    q('presetSelect').value = '';
    q('presetDeleteBtn').disabled = true;
    refresh();
  }
  const pickers = {};
  [['frameStyle', 'frame-style', FRAME_STYLE_OPTIONS], ['pointShape', 'shape', SHAPE_OPTIONS],
    ['lineStyle', 'line-style', LINE_STYLE_OPTIONS]].forEach(([key, kind, options]) => {
    pickers[key] = createChartStylePicker(q(key), { kind, options, value: store.getStyle()[key],
      onChange: (value) => {
        if (refreshing) return;
        apply(key === 'frameStyle' ? { [key]: value } : seriesStylePatch(store.getStyle(), selection.series, key, value));
      } });
    q(key).querySelector('button').setAttribute('aria-label', key === 'frameStyle' ? 'Frame style' : key === 'pointShape' ? 'Symbol shape' : 'Line pattern');
  });
  const textControls = createChartTextControls(q('textBar'), {
    basicOnly: true,
    value: {},
    onChange: (value) => {
      if (refreshing) return;
      const style = store.getStyle();
      apply({ textStyles: { ...style.textStyles, [selection.text]: { ...value, fontSize: pointsToPixels(value.fontSize) } } });
    }
  });
  form = createChartControlsForm({ q, store, selection, pickers, textControls });
  function refresh() {
    refreshing = true;
    form.refresh();
    refreshing = false;
  }
  function selectTab(id) {
    activeTab = TABS.some((tab) => tab.id === id) ? id : 'frame';
    container.querySelectorAll('[data-cc-tab]').forEach((button) => {
      const selected = button.dataset.ccTab === activeTab;
      button.setAttribute('aria-selected', String(selected));
      button.tabIndex = selected ? 0 : -1;
    });
    container.querySelectorAll('[data-cc-panel]').forEach((panel) => { panel.hidden = panel.dataset.ccPanel !== activeTab; });
  }
  function refreshPresets(selected = '') {
    form.options('presetSelect', [['', 'Custom'], [FIGURE_CLASSIC_PRESET, 'Figure Classic'],
      ...listChartPresets().map((name) => [`saved:${name}`, name === 'Figure Classic' ? `${name} (saved)` : name])]);
    q('presetSelect').value = selected;
    q('presetDeleteBtn').disabled = !selected || selected === FIGURE_CLASSIC_PRESET;
  }
  function read(key) {
    const input = q(key);
    if (input.type === 'checkbox') return input.checked;
    if (input.type !== 'number') return input.value;
    if (!input.value.trim()) return null;
    const value = Number(input.value);
    return POINT_FIELDS.has(key) ? pointsToPixels(value) : value;
  }
  function changeAxis(axis) {
    const scale = read(`${axis}Scale`);
    const range = { auto: read(`${axis}RangeAuto`), min: read(`${axis}Min`), max: read(`${axis}Max`) };
    q(`${axis}Min`).disabled = range.auto;
    q(`${axis}Max`).disabled = range.auto;
    const error = validateAxisRange(scale, range);
    if (error) { notice(error); return; }
    apply({ [`${axis}Scale`]: scale, [`${axis}Range`]: range });
  }
  // Both axes are on screen at once, so the edited field's own key names its axis.
  function changeAxisField(axis, suffix, style) {
    if (['Scale', 'RangeAuto', 'Min', 'Max'].includes(suffix)) { changeAxis(axis); return; }
    if (suffix === 'TickPreset') {
      const value = read(`${axis}TickPreset`);
      selection.customTick[axis] = value === 'custom';
      if (value === 'custom') {
        notice(); refresh(); q(`${axis}Tick`).focus(); q(`${axis}Tick`).select(); return;
      }
      apply({ [`${axis}Tick`]: value === 'auto' ? null : Number(value) }); return;
    }
    if (suffix === 'Tick') {
      const value = read(`${axis}Tick`);
      if (value !== null && value <= 0) { notice('Tick interval must be greater than zero.'); return; }
      apply({ [`${axis}Tick`]: value }); return;
    }
    apply(axisStylePatch(style, axis, axisStyleKey(suffix), read(`${axis}${suffix}`)));
  }
  function onChange(event) {
    if (refreshing) return;
    const key = event.target.dataset.cc;
    if (!key) return;
    if (event.target.type === 'number' && !event.target.validity.valid) {
      notice('Enter a value within the indicated limits.');
      return;
    }
    const style = store.getStyle();
    if (key === 'seriesTarget' || key === 'textTarget') {
      if (key === 'seriesTarget') selection.series = read(key) === '' ? null : store.getContext().seriesLabels[Number(read(key))];
      if (key === 'textTarget') selection.text = read(key);
      notice(); refresh(); return;
    }
    const axisMatch = /^([xy])(.+)$/.exec(key);
    if (axisMatch && AXIS_FIELDS.includes(axisMatch[2])) {
      changeAxisField(axisMatch[1], axisMatch[2], style); return;
    }
    if (SERIES_FIELDS.includes(key)) { apply(seriesStylePatch(style, selection.series, key, read(key))); return; }
    if (GLOBAL_FIELDS.includes(key)) {
      if (key === 'refLineValue' && read(key) !== null) {
        const axis = style.refLineAxis;
        if (style[`${axis}Scale`] !== 'linear' && read(key) <= 0) {
          notice('A logarithmic reference value must be greater than zero.'); return;
        }
      }
      apply({ [key]: read(key) }); return;
    }
    if (['titleText', 'titlePos', 'titleOffset'].includes(key)) {
      const target = selection.text;
      const field = key === 'titleText' ? target : `${target}${key === 'titlePos' ? 'Pos' : 'Offset'}`;
      const value = read(key);
      apply({ [field]: key === 'titleOffset' && value !== null ? pointsToPixels(value) : value }); return;
    }
    if (key === 'presetSelect') {
      const name = read(key);
      const preset = name === FIGURE_CLASSIC_PRESET ? figureClassicPatch() : name && getChartPreset(name.slice(6));
      if (preset) apply(preset);
      refreshPresets(name);
    }
  }
  function onInput(event) {
    if (event.target.type === 'color' || event.target.dataset.cc === 'titleText') onChange(event);
  }
  function onClick(event) {
    const button = event.target.closest('button');
    if (!button || !container.contains(button)) return;
    if (button.dataset.ccTab) { selectTab(button.dataset.ccTab); return; }
    const key = button.dataset.cc;
    if (key === 'resetBtn') { notice(); selection.customTick = {}; store.resetStyle(); refresh(); refreshPresets(); }
    if (key === 'resetTabBtn') {
      const defaults = store.getDefaultStyle();
      if (activeTab === 'axis') selection.customTick = {};
      apply(Object.fromEntries(TAB_KEYS[activeTab].map((field) => [field, defaults[field]])));
    }
    if (key === 'seriesDefaults' && selection.series !== null) {
      const style = store.getStyle();
      const patch = {};
      ['seriesStyles', 'seriesColors', 'seriesShapes'].forEach((field) => {
        patch[field] = { ...style[field] }; delete patch[field][selection.series];
      });
      apply(patch);
    }
    if (key === 'presetSaveBtn') {
      const current = q('presetSelect').value;
      const name = sanitizePresetName(askName('Save this chart style as:', current.startsWith('saved:') ? current.slice(6) : ''));
      if (name) {
        if (saveChartPreset(name, store.getStyle())) refreshPresets(`saved:${name}`);
        else notice('Unable to save this preset.');
      }
    }
    if (key === 'presetDeleteBtn') {
      if (q('presetSelect').value.startsWith('saved:') && deleteChartPreset(q('presetSelect').value.slice(6))) refreshPresets();
      else notice('Unable to delete this preset.');
    }
  }
  function onKeyDown(event) {
    if (!event.target.closest('[role="tab"]')) return;
    const index = TABS.findIndex((tab) => tab.id === activeTab);
    const next = event.key === 'ArrowRight' ? (index + 1) % TABS.length
      : event.key === 'ArrowLeft' ? (index - 1 + TABS.length) % TABS.length
        : event.key === 'Home' ? 0 : event.key === 'End' ? TABS.length - 1 : -1;
    if (next < 0) return;
    event.preventDefault();
    selectTab(TABS[next].id);
    q('frameStyle').closest('.assay-chart-style').querySelector(`[data-cc-tab="${activeTab}"]`).focus();
  }
  container.addEventListener('change', onChange);
  container.addEventListener('input', onInput);
  container.addEventListener('click', onClick);
  container.addEventListener('keydown', onKeyDown);
  refreshPresets(); selectTab(activeTab); refresh();
  return { refresh, selectTab, destroy() {
    container.removeEventListener('change', onChange);
    container.removeEventListener('input', onInput);
    container.removeEventListener('click', onClick);
    container.removeEventListener('keydown', onKeyDown);
    Object.values(pickers).forEach((picker) => picker.destroy());
    textControls.destroy(); container.innerHTML = '';
  } };
}
