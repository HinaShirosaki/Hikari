import { createChartStylePicker } from './chart-style-pickers.js';
import { getCachedFonts, loadSystemFonts } from './chart-font-source.js';

// Text controls for the Assay Plotly style panel.

const FONT_SIZE_OPTIONS = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48].map((v) => ({
  value: v,
  label: String(v)
}));

const SVG_NS = 'http://www.w3.org/2000/svg';
function svgEl(tag, attrs) {
  const el = document.createElementNS(SVG_NS, tag);
  if (attrs) for (const key in attrs) el.setAttribute(key, attrs[key]);
  return el;
}

function makeIcon(viewBox, draw) {
  const svg = svgEl('svg', { viewBox, width: '14', height: '14' });
  draw(svg);
  return svg;
}

const ICONS = {
  bold: () => makeIcon('0 0 16 16', (svg) => {
    const t = svgEl('text', {
      x: '8', y: '12', 'text-anchor': 'middle',
      'font-family': 'sans-serif', 'font-weight': '900', 'font-size': '13', fill: 'currentColor'
    });
    t.textContent = 'B';
    svg.appendChild(t);
  }),
  italic: () => makeIcon('0 0 16 16', (svg) => {
    const t = svgEl('text', {
      x: '8', y: '12', 'text-anchor': 'middle',
      'font-family': 'sans-serif', 'font-style': 'italic', 'font-size': '13', fill: 'currentColor'
    });
    t.textContent = 'I';
    svg.appendChild(t);
  }),
  underline: () => makeIcon('0 0 16 16', (svg) => {
    const t = svgEl('text', {
      x: '8', y: '11', 'text-anchor': 'middle',
      'font-family': 'sans-serif', 'font-size': '12', fill: 'currentColor'
    });
    t.textContent = 'U';
    svg.appendChild(t);
    svg.appendChild(svgEl('line', {
      x1: '3', y1: '14', x2: '13', y2: '14',
      stroke: 'currentColor', 'stroke-width': '1.4'
    }));
  }),
  superscript: () => makeIcon('0 0 16 16', (svg) => {
    const t = svgEl('text', {
      x: '4', y: '13', 'font-size': '11', fill: 'currentColor'
    });
    t.textContent = 'x';
    svg.appendChild(t);
    const sup = svgEl('text', {
      x: '10', y: '7', 'font-size': '7', fill: 'currentColor'
    });
    sup.textContent = '2';
    svg.appendChild(sup);
  }),
  subscript: () => makeIcon('0 0 16 16', (svg) => {
    const t = svgEl('text', {
      x: '4', y: '12', 'font-size': '11', fill: 'currentColor'
    });
    t.textContent = 'x';
    svg.appendChild(t);
    const sub = svgEl('text', {
      x: '10', y: '15', 'font-size': '7', fill: 'currentColor'
    });
    sub.textContent = '2';
    svg.appendChild(sub);
  }),
  alignLeft: () => makeIcon('0 0 16 16', (svg) => {
    const lines = [
      ['2', '4', '14', '4'],
      ['2', '7', '10', '7'],
      ['2', '10', '13', '10'],
      ['2', '13', '8', '13']
    ];
    lines.forEach(([x1, y1, x2, y2]) => {
      svg.appendChild(svgEl('line', {
        x1, y1, x2, y2, stroke: 'currentColor', 'stroke-width': '1.2', 'stroke-linecap': 'round'
      }));
    });
  }),
  alignCenter: () => makeIcon('0 0 16 16', (svg) => {
    const lines = [
      ['2', '4', '14', '4'],
      ['4', '7', '12', '7'],
      ['3', '10', '13', '10'],
      ['5', '13', '11', '13']
    ];
    lines.forEach(([x1, y1, x2, y2]) => {
      svg.appendChild(svgEl('line', {
        x1, y1, x2, y2, stroke: 'currentColor', 'stroke-width': '1.2', 'stroke-linecap': 'round'
      }));
    });
  }),
  alignRight: () => makeIcon('0 0 16 16', (svg) => {
    const lines = [
      ['2', '4', '14', '4'],
      ['6', '7', '14', '7'],
      ['3', '10', '14', '10'],
      ['8', '13', '14', '13']
    ];
    lines.forEach(([x1, y1, x2, y2]) => {
      svg.appendChild(svgEl('line', {
        x1, y1, x2, y2, stroke: 'currentColor', 'stroke-width': '1.2', 'stroke-linecap': 'round'
      }));
    });
  })
};

function fontFamilyCss(name) {
  if (!name) return 'inherit';
  return /[\s"']/.test(name) ? `"${name.replace(/"/g, '\\"')}"` : name;
}

function buildFontOption(family) {
  const span = document.createElement('span');
  span.className = 'assay-chart-text-font-option';
  span.style.fontFamily = fontFamilyCss(family);
  span.textContent = family;
  return span;
}

export function createChartTextControls(mount, config) {
  if (!mount) return null;
  const onChange = typeof config?.onChange === 'function' ? config.onChange : () => {};
  let value = { ...config?.value };

  mount.innerHTML = '';
  mount.classList.add('assay-chart-text-bar');

  const row1 = document.createElement('div');
  row1.className = 'assay-chart-text-bar__row';
  mount.appendChild(row1);

  const row2 = document.createElement('div');
  row2.className = 'assay-chart-text-bar__row';
  mount.appendChild(row2);

  const fontMount = document.createElement('div');
  fontMount.className = 'assay-chart-text-bar__font-mount';
  row1.appendChild(fontMount);

  const sizeMount = document.createElement('div');
  sizeMount.className = 'assay-chart-text-bar__size-mount';
  row1.appendChild(sizeMount);

  const colorWrap = document.createElement('label');
  colorWrap.className = 'assay-chart-text-bar__color';
  colorWrap.title = 'Text color';
  const colorInput = document.createElement('input');
  colorInput.type = 'color';
  colorWrap.appendChild(colorInput);
  row1.appendChild(colorWrap);

  function buildFontOptions(list) {
    return list.map((family) => ({ value: family, label: family }));
  }

  const fontPicker = createChartStylePicker(fontMount, {
    kind: 'font-family',
    options: buildFontOptions(getCachedFonts()),
    value: value.fontFamily || 'Arial',
    renderOption: (opt) => buildFontOption(opt.value),
    renderTrigger: () => null,
    onChange: (val) => {
      value.fontFamily = val;
      updateTriggerFont();
      emit();
    }
  });
  fontMount.classList.add('assay-chart-text-bar__font');

  function updateTriggerFont() {
    const trigger = fontMount.querySelector('.assay-chart-picker__label');
    if (trigger) trigger.style.fontFamily = fontFamilyCss(value.fontFamily);
  }
  updateTriggerFont();

  loadSystemFonts().then((list) => {
    if (!fontPicker) return;
    fontPicker.setOptions(buildFontOptions(list));
  }).catch(() => {});

  const sizePicker = createChartStylePicker(sizeMount, {
    kind: 'font-size',
    options: FONT_SIZE_OPTIONS,
    value: Number.isFinite(value.fontSize) ? value.fontSize : 12,
    onChange: (val) => {
      value.fontSize = Number(val) || 12;
      emit();
    }
  });

  colorInput.value = value.color || '#222222';
  colorInput.addEventListener('input', () => {
    value.color = colorInput.value;
    emit();
  });

  function makeToggle(key, iconKey, tooltip) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'assay-chart-text-bar__toggle';
    btn.setAttribute('aria-label', tooltip);
    btn.setAttribute('data-hover-caption', tooltip);
    btn.appendChild(ICONS[iconKey]());
    btn.addEventListener('click', () => {
      value[key] = !value[key];
      btn.classList.toggle('is-active', Boolean(value[key]));
      emit();
    });
    if (value[key]) btn.classList.add('is-active');
    return btn;
  }

  const boldBtn = makeToggle('bold', 'bold', 'Bold');
  const italicBtn = makeToggle('italic', 'italic', 'Italic');
  const underlineBtn = makeToggle('underline', 'underline', 'Underline');
  row2.appendChild(boldBtn);
  row2.appendChild(italicBtn);
  row2.appendChild(underlineBtn);

  const sep1 = document.createElement('span');
  sep1.className = 'assay-chart-text-bar__sep';
  row2.appendChild(sep1);

  function makeBaselineButton(baselineValue, iconKey, tooltip) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'assay-chart-text-bar__toggle';
    btn.setAttribute('aria-label', tooltip);
    btn.setAttribute('data-hover-caption', tooltip);
    btn.appendChild(ICONS[iconKey]());
    btn.addEventListener('click', () => {
      value.baseline = value.baseline === baselineValue ? 'baseline' : baselineValue;
      syncBaselineButtons();
      emit();
    });
    return btn;
  }

  const supBtn = makeBaselineButton('super', 'superscript', 'Superscript');
  const subBtn = makeBaselineButton('sub', 'subscript', 'Subscript');
  row2.appendChild(supBtn);
  row2.appendChild(subBtn);

  function syncBaselineButtons() {
    supBtn.classList.toggle('is-active', value.baseline === 'super');
    subBtn.classList.toggle('is-active', value.baseline === 'sub');
  }
  syncBaselineButtons();

  const sep2 = document.createElement('span');
  sep2.className = 'assay-chart-text-bar__sep';
  row2.appendChild(sep2);

  function makeAlignButton(alignValue, iconKey, tooltip) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'assay-chart-text-bar__toggle';
    btn.setAttribute('aria-label', tooltip);
    btn.setAttribute('data-hover-caption', tooltip);
    btn.appendChild(ICONS[iconKey]());
    btn.addEventListener('click', () => {
      value.textAlign = alignValue;
      syncAlignButtons();
      emit();
    });
    return btn;
  }

  const alignLeftBtn = makeAlignButton('start', 'alignLeft', 'Align left');
  const alignCenterBtn = makeAlignButton('middle', 'alignCenter', 'Align center');
  const alignRightBtn = makeAlignButton('end', 'alignRight', 'Align right');
  row2.appendChild(alignLeftBtn);
  row2.appendChild(alignCenterBtn);
  row2.appendChild(alignRightBtn);

  function syncAlignButtons() {
    alignLeftBtn.classList.toggle('is-active', value.textAlign === 'start');
    alignCenterBtn.classList.toggle('is-active', value.textAlign === 'middle');
    alignRightBtn.classList.toggle('is-active', value.textAlign === 'end');
  }
  syncAlignButtons();

  let suppress = false;

  function emit() {
    if (suppress) return;
    onChange({ ...value });
  }

  function setValue(next) {
    suppress = true;
    value = { ...next };
    if (fontPicker) fontPicker.setValue(value.fontFamily);
    updateTriggerFont();
    if (sizePicker) sizePicker.setValue(value.fontSize);
    if (colorInput) colorInput.value = value.color || '#222222';
    boldBtn.classList.toggle('is-active', Boolean(value.bold));
    italicBtn.classList.toggle('is-active', Boolean(value.italic));
    underlineBtn.classList.toggle('is-active', Boolean(value.underline));
    syncBaselineButtons();
    syncAlignButtons();
    suppress = false;
  }

  setValue(value);

  return {
    setValue,
    destroy() {
      if (fontPicker) fontPicker.destroy();
      if (sizePicker) sizePicker.destroy();
      mount.innerHTML = '';
      mount.classList.remove('assay-chart-text-bar');
    }
  };
}
