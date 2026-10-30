import { createChartStylePicker } from './chart-style-pickers.js';
import { getCachedFonts, loadSystemFonts } from './chart-font-source.js';

// Text controls for the Assay Plotly style panel.

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
  let destroyed = false;

  mount.innerHTML = '';
  mount.classList.add('assay-chart-text-bar');

  // One wrapping toolbar: font, size and the formatting controls share a line when the panel allows it.
  const bar = document.createElement('div');
  bar.className = 'assay-chart-text-bar__row';
  mount.appendChild(bar);

  const fontMount = document.createElement('div');
  fontMount.className = 'assay-chart-text-bar__font-mount';
  bar.appendChild(fontMount);

  const sizeMount = document.createElement('div');
  sizeMount.className = 'assay-chart-text-bar__size-mount';
  bar.appendChild(sizeMount);

  const colorWrap = document.createElement('label');
  colorWrap.className = 'assay-chart-text-bar__color';
  colorWrap.title = 'Text color';
  const colorInput = document.createElement('input');
  colorInput.type = 'color';
  colorInput.setAttribute('aria-label', 'Text color');
  colorWrap.appendChild(colorInput);
  bar.appendChild(colorWrap);

  function buildFontOptions(list) {
    return list.map((family) => ({ value: family, label: family }));
  }

  const fontPicker = createChartStylePicker(fontMount, {
    kind: 'font-family',
    options: buildFontOptions(getCachedFonts()),
    value: value.fontFamily || 'Arial',
    renderOption: (opt) => buildFontOption(opt.value),
    renderTrigger: () => null,
    showLabelInOption: false,
    onChange: (val) => {
      value.fontFamily = val;
      updateTriggerFont();
      emit();
    }
  });
  fontMount.classList.add('assay-chart-text-bar__font');
  fontMount.querySelector('button').setAttribute('aria-label', 'Font family');

  function updateTriggerFont() {
    const trigger = fontMount.querySelector('.assay-chart-picker__label');
    if (trigger) trigger.style.fontFamily = fontFamilyCss(value.fontFamily);
  }
  updateTriggerFont();

  loadSystemFonts().then((list) => {
    if (destroyed || !fontPicker) return;
    fontPicker.setOptions(buildFontOptions(list));
  }).catch(() => {});

  const sizeInput = document.createElement('input');
  sizeInput.type = 'number';
  sizeInput.min = '4.5';
  sizeInput.max = '72';
  sizeInput.step = 'any';
  sizeInput.setAttribute('aria-label', 'Font size (pt)');
  sizeInput.title = 'Font size (pt)';
  sizeMount.appendChild(sizeInput);
  const sizeUnit = document.createElement('span');
  sizeUnit.className = 'assay-chart-text-bar__unit';
  sizeUnit.textContent = 'pt';
  sizeMount.appendChild(sizeUnit);
  sizeInput.addEventListener('change', () => {
    if (!sizeInput.value || !sizeInput.validity.valid) return;
    value.fontSize = Number(sizeInput.value);
    emit();
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
      btn.setAttribute('aria-pressed', String(Boolean(value[key])));
      emit();
    });
    if (value[key]) btn.classList.add('is-active');
    btn.setAttribute('aria-pressed', String(Boolean(value[key])));
    return btn;
  }

  const boldBtn = makeToggle('bold', 'bold', 'Bold');
  const italicBtn = makeToggle('italic', 'italic', 'Italic');
  const underlineBtn = makeToggle('underline', 'underline', 'Underline');
  bar.appendChild(boldBtn);
  bar.appendChild(italicBtn);
  bar.appendChild(underlineBtn);

  const sep1 = document.createElement('span');
  sep1.className = 'assay-chart-text-bar__sep';
  bar.appendChild(sep1);

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
  bar.appendChild(supBtn);
  bar.appendChild(subBtn);

  function syncBaselineButtons() {
    supBtn.classList.toggle('is-active', value.baseline === 'super');
    subBtn.classList.toggle('is-active', value.baseline === 'sub');
  }
  syncBaselineButtons();

  const sep2 = document.createElement('span');
  sep2.className = 'assay-chart-text-bar__sep';
  bar.appendChild(sep2);

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
  bar.appendChild(alignLeftBtn);
  bar.appendChild(alignCenterBtn);
  bar.appendChild(alignRightBtn);
  if (config?.basicOnly) {
    [sep1, sep2, supBtn, subBtn, alignLeftBtn, alignCenterBtn, alignRightBtn].forEach((element) => element.remove());
  }

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
    sizeInput.value = String(Number((value.fontSize || 10).toFixed(6)));
    if (colorInput) colorInput.value = value.color || '#222222';
    boldBtn.classList.toggle('is-active', Boolean(value.bold));
    italicBtn.classList.toggle('is-active', Boolean(value.italic));
    underlineBtn.classList.toggle('is-active', Boolean(value.underline));
    [[boldBtn, value.bold], [italicBtn, value.italic], [underlineBtn, value.underline]]
      .forEach(([button, pressed]) => button.setAttribute('aria-pressed', String(Boolean(pressed))));
    syncBaselineButtons();
    syncAlignButtons();
    suppress = false;
  }

  setValue(value);

  return {
    setValue,
    destroy() {
      destroyed = true;
      if (fontPicker) fontPicker.destroy();
      mount.innerHTML = '';
      mount.classList.remove('assay-chart-text-bar');
    }
  };
}
