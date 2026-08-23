// DOM pickers used by the Assay Plotly style panel.
const SVG_NS = 'http://www.w3.org/2000/svg';

let openPicker = null;
let globalListenersInstalled = false;

function installGlobalListeners() {
  if (globalListenersInstalled) return;
  globalListenersInstalled = true;
  document.addEventListener('pointerdown', (event) => {
    if (!openPicker) return;
    if (openPicker.root.contains(event.target)) return;
    if (openPicker.popup && openPicker.popup.contains(event.target)) return;
    openPicker.close();
  }, true);
  document.addEventListener('keydown', (event) => {
    if (!openPicker) return;
    if (event.key === 'Escape') {
      openPicker.close();
    }
  });
  window.addEventListener('resize', () => openPicker && openPicker.close());
  window.addEventListener('scroll', () => openPicker && openPicker.close(), true);
}

function svgEl(tag, attrs) {
  const el = document.createElementNS(SVG_NS, tag);
  if (attrs) {
    for (const key in attrs) {
      el.setAttribute(key, attrs[key]);
    }
  }
  return el;
}

function makeIconSvg(width, height, viewBox) {
  const svg = svgEl('svg', {
    width: String(width),
    height: String(height),
    viewBox: viewBox || `0 0 ${width} ${height}`
  });
  return svg;
}

const SHAPE_LABELS = {
  circle: 'Circle',
  square: 'Square',
  triangle: 'Triangle',
  diamond: 'Diamond',
  cross: 'Cross'
};

function shapePathInBox(shape, size) {
  const half = size / 2;
  const svg = makeIconSvg(size, size, `${-half} ${-half} ${size} ${size}`);
  const color = 'currentColor';
  switch (shape) {
    case 'square':
      svg.appendChild(svgEl('rect', {
        x: String(-half * 0.85),
        y: String(-half * 0.85),
        width: String(size * 0.85),
        height: String(size * 0.85),
        fill: color
      }));
      break;
    case 'triangle': {
      const r = half * 0.95;
      const pts = `0,${-r} ${r * 0.95},${r * 0.75} ${-r * 0.95},${r * 0.75}`;
      svg.appendChild(svgEl('polygon', { points: pts, fill: color }));
      break;
    }
    case 'diamond': {
      const r = half * 0.95;
      const pts = `0,${-r} ${r},0 0,${r} ${-r},0`;
      svg.appendChild(svgEl('polygon', { points: pts, fill: color }));
      break;
    }
    case 'cross': {
      const r = half * 0.9;
      const w = Math.max(1.2, size * 0.18);
      const path = svgEl('path', {
        d: `M ${-r} 0 H ${r} M 0 ${-r} V ${r}`,
        stroke: color,
        'stroke-width': String(w),
        'stroke-linecap': 'round',
        fill: 'none'
      });
      svg.appendChild(path);
      break;
    }
    case 'circle':
    default:
      svg.appendChild(svgEl('circle', {
        cx: '0',
        cy: '0',
        r: String(half * 0.85),
        fill: color
      }));
      break;
  }
  return svg;
}

function lineStyleSvg(style, options) {
  const w = options?.width ?? 44;
  const h = options?.height ?? 14;
  const stroke = options?.stroke ?? 1.8;
  const svg = makeIconSvg(w, h);
  const dash = style === 'dashed' ? '6,4' : style === 'dotted' ? '1.5,3' : null;
  const line = svgEl('line', {
    x1: '2',
    y1: String(h / 2),
    x2: String(w - 2),
    y2: String(h / 2),
    stroke: 'currentColor',
    'stroke-width': String(stroke),
    'stroke-linecap': style === 'dotted' ? 'round' : 'butt'
  });
  if (dash) line.setAttribute('stroke-dasharray', dash);
  svg.appendChild(line);
  return svg;
}

function frameStyleSvg(style) {
  const w = 40;
  const h = 22;
  const svg = makeIconSvg(w, h);
  const stroke = 'currentColor';
  const sw = '1.4';
  if (style === 'box') {
    svg.appendChild(svgEl('rect', {
      x: '3', y: '3', width: String(w - 6), height: String(h - 6),
      fill: 'none', stroke, 'stroke-width': sw, rx: '2'
    }));
  } else if (style === 'offset') {
    // Prism offset axes: the two arms stop short of the origin corner.
    svg.appendChild(svgEl('path', {
      d: `M 3 3 V ${h - 8} M 8 ${h - 3} H ${w - 3}`,
      fill: 'none', stroke, 'stroke-width': sw, 'stroke-linecap': 'round'
    }));
  } else if (style === 'l-shape') {
    svg.appendChild(svgEl('path', {
      d: `M 3 3 V ${h - 3} H ${w - 3}`,
      fill: 'none', stroke, 'stroke-width': sw, 'stroke-linecap': 'round',
      'stroke-linejoin': 'round'
    }));
  } else {
    svg.appendChild(svgEl('line', {
      x1: '3', y1: String(h - 3), x2: String(w - 3), y2: String(h - 3),
      stroke, 'stroke-width': sw, 'stroke-dasharray': '2,3'
    }));
  }
  return svg;
}

function strokeWidthSvg(width, opts) {
  const w = opts?.width ?? 44;
  const h = opts?.height ?? 14;
  const svg = makeIconSvg(w, h);
  if (width <= 0) {
    const tx = svgEl('text', {
      x: String(w / 2), y: String(h / 2 + 4),
      'text-anchor': 'middle',
      'font-size': '10', fill: 'currentColor', opacity: '0.55'
    });
    tx.textContent = 'none';
    svg.appendChild(tx);
  } else {
    svg.appendChild(svgEl('line', {
      x1: '3', y1: String(h / 2), x2: String(w - 3), y2: String(h / 2),
      stroke: 'currentColor', 'stroke-width': String(Math.max(0.4, width)),
      'stroke-linecap': 'round'
    }));
  }
  return svg;
}

function caretSvg() {
  const svg = makeIconSvg(10, 10);
  svg.appendChild(svgEl('path', {
    d: 'M 1.5 3.5 L 5 7 L 8.5 3.5',
    fill: 'none', stroke: 'currentColor',
    'stroke-width': '1.4', 'stroke-linecap': 'round',
    'stroke-linejoin': 'round'
  }));
  return svg;
}

function formatNumber(value) {
  if (!Number.isFinite(value)) return String(value);
  if (Number.isInteger(value)) return String(value);
  return String(Number(value.toFixed(2)));
}

function pickPreviewBuilders(kind) {
  switch (kind) {
    case 'shape':
      return {
        renderOption: (opt) => shapePathInBox(opt.value, 18),
        renderTrigger: (opt) => shapePathInBox(opt.value, 16),
        showLabelInTrigger: false,
        showLabelInOption: true,
        optionTooltip: (opt) => SHAPE_LABELS[opt.value] || opt.value
      };
    case 'line-style':
      return {
        renderOption: (opt) => lineStyleSvg(opt.value),
        renderTrigger: (opt) => lineStyleSvg(opt.value, { width: 36, height: 12 }),
        showLabelInTrigger: false,
        showLabelInOption: true
      };
    case 'frame-style':
      return {
        renderOption: (opt) => frameStyleSvg(opt.value),
        renderTrigger: (opt) => frameStyleSvg(opt.value),
        showLabelInTrigger: false,
        showLabelInOption: true
      };
    default:
      return null;
  }
}

function applyPopupPosition(trigger, popup) {
  const triggerRect = trigger.getBoundingClientRect();
  popup.style.minWidth = `${triggerRect.width}px`;
  popup.style.visibility = 'hidden';
  popup.style.display = 'grid';
  const popupRect = popup.getBoundingClientRect();
  const viewportH = window.innerHeight;
  const viewportW = window.innerWidth;
  let top = triggerRect.bottom + 4;
  let left = triggerRect.left;
  if (top + popupRect.height > viewportH - 8) {
    top = Math.max(8, triggerRect.top - popupRect.height - 4);
  }
  if (left + popupRect.width > viewportW - 8) {
    left = Math.max(8, viewportW - popupRect.width - 8);
  }
  popup.style.top = `${top}px`;
  popup.style.left = `${left}px`;
  popup.style.visibility = '';
}

export function createChartStylePicker(mount, config) {
  if (!mount || !config) return null;
  installGlobalListeners();
  const kind = config.kind;
  const onChange = typeof config.onChange === 'function' ? config.onChange : () => {};
  let options = Array.isArray(config.options) ? config.options.slice() : [];
  let currentValue = config.value;
  let shapeContext = config.shapeContext || 'circle';
  let menuColumns = config.menuColumns || 1;

  mount.innerHTML = '';
  mount.classList.add('assay-chart-picker');
  mount.dataset.pickerKind = kind;

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'assay-chart-picker__trigger';
  trigger.setAttribute('aria-haspopup', 'listbox');
  trigger.setAttribute('aria-expanded', 'false');
  mount.appendChild(trigger);

  const previewWrap = document.createElement('span');
  previewWrap.className = 'assay-chart-picker__preview';
  trigger.appendChild(previewWrap);

  const labelEl = document.createElement('span');
  labelEl.className = 'assay-chart-picker__label';
  trigger.appendChild(labelEl);

  const caretWrap = document.createElement('span');
  caretWrap.className = 'assay-chart-picker__caret';
  caretWrap.appendChild(caretSvg());
  trigger.appendChild(caretWrap);

  const popup = document.createElement('div');
  popup.className = 'assay-chart-picker__menu';
  popup.setAttribute('role', 'listbox');
  popup.style.display = 'none';
  popup.style.position = 'fixed';
  popup.style.zIndex = '9999';
  if (menuColumns > 1) {
    popup.style.gridTemplateColumns = `repeat(${menuColumns}, auto)`;
    popup.classList.add('assay-chart-picker__menu--grid');
  }
  document.body.appendChild(popup);

  function buildOptionPreview(opt) {
    if (typeof config.renderOption === 'function') {
      return config.renderOption(opt);
    }
    const stylePreset = pickPreviewBuilders(kind);
    if (stylePreset) {
      return stylePreset.renderOption(opt);
    }
    switch (kind) {
      case 'point-size':
        return shapePathInBox(shapeContext, Math.max(6, Math.min(22, opt.value)));
      case 'line-width':
        return strokeWidthSvg(opt.value, { width: 52, height: 14 });
      case 'stroke-width':
      case 'grid-width':
        return strokeWidthSvg(opt.value, { width: 52, height: 12 });
      default:
        return makeIconSvg(0, 0);
    }
  }

  function buildTriggerPreview(opt) {
    if (!opt) return null;
    if (typeof config.renderTrigger === 'function') {
      return config.renderTrigger(opt);
    }
    const stylePreset = pickPreviewBuilders(kind);
    if (stylePreset) {
      return stylePreset.renderTrigger(opt);
    }
    switch (kind) {
      case 'point-size':
        return shapePathInBox(shapeContext, Math.max(6, Math.min(20, opt.value)));
      case 'line-width':
        return strokeWidthSvg(opt.value, { width: 36, height: 12 });
      case 'stroke-width':
      case 'grid-width':
        return strokeWidthSvg(opt.value, { width: 36, height: 12 });
      default:
        return null;
    }
  }

  function labelForOption(opt) {
    if (!opt) return '';
    if (opt.label !== undefined && opt.label !== null) return String(opt.label);
    if (typeof opt.value === 'number') return formatNumber(opt.value);
    return SHAPE_LABELS[opt.value] || String(opt.value);
  }

  function findOption(value) {
    return options.find((o) => o.value === value);
  }

  function renderTrigger() {
    previewWrap.innerHTML = '';
    labelEl.textContent = '';
    const opt = findOption(currentValue);
    const stylePreset = pickPreviewBuilders(kind);
    const preview = buildTriggerPreview(opt);
    if (preview) {
      previewWrap.appendChild(preview);
    }
    const showLabel = stylePreset ? stylePreset.showLabelInTrigger : true;
    if (showLabel || !preview) {
      labelEl.textContent = labelForOption(opt);
      labelEl.style.display = '';
    } else {
      labelEl.style.display = 'none';
    }
    const tooltip = stylePreset?.optionTooltip ? stylePreset.optionTooltip(opt || {}) : labelForOption(opt);
    trigger.title = tooltip;
  }

  function renderMenu() {
    popup.innerHTML = '';
    const stylePreset = pickPreviewBuilders(kind);
    options.forEach((opt) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'assay-chart-picker__option';
      item.setAttribute('role', 'option');
      item.dataset.value = String(opt.value);
      if (opt.value === currentValue) {
        item.classList.add('is-selected');
        item.setAttribute('aria-selected', 'true');
      }
      const optPreview = document.createElement('span');
      optPreview.className = 'assay-chart-picker__option-preview';
      const previewNode = buildOptionPreview(opt);
      if (previewNode) optPreview.appendChild(previewNode);
      item.appendChild(optPreview);

      const showLabel = stylePreset ? stylePreset.showLabelInOption : true;
      if (showLabel) {
        const lbl = document.createElement('span');
        lbl.className = 'assay-chart-picker__option-label';
        lbl.textContent = labelForOption(opt);
        item.appendChild(lbl);
      }
      const tooltip = stylePreset?.optionTooltip ? stylePreset.optionTooltip(opt) : labelForOption(opt);
      item.title = tooltip;

      item.addEventListener('click', () => {
        setValue(opt.value);
        onChange(opt.value);
        close();
      });
      popup.appendChild(item);
    });
  }

  function open() {
    if (openPicker && openPicker !== api) openPicker.close();
    renderMenu();
    applyPopupPosition(trigger, popup);
    trigger.setAttribute('aria-expanded', 'true');
    mount.classList.add('is-open');
    openPicker = api;
  }

  function close() {
    popup.style.display = 'none';
    trigger.setAttribute('aria-expanded', 'false');
    mount.classList.remove('is-open');
    if (openPicker === api) openPicker = null;
  }

  function toggle() {
    if (popup.style.display === 'none') open();
    else close();
  }

  function setValue(value) {
    currentValue = value;
    renderTrigger();
  }

  function setOptions(next) {
    options = Array.isArray(next) ? next.slice() : [];
    renderTrigger();
    if (popup.style.display !== 'none') renderMenu();
  }

  function setShapeContext(shape) {
    shapeContext = shape;
    if (kind === 'point-size') {
      renderTrigger();
      if (popup.style.display !== 'none') renderMenu();
    }
  }

  trigger.addEventListener('click', (event) => {
    event.preventDefault();
    toggle();
  });

  const api = {
    root: mount,
    popup,
    get value() { return currentValue; },
    setValue,
    setOptions,
    setShapeContext,
    open,
    close,
    destroy() {
      close();
      popup.remove();
      mount.innerHTML = '';
      mount.classList.remove('assay-chart-picker', 'is-open');
      delete mount.dataset.pickerKind;
    }
  };

  renderTrigger();
  return api;
}

export const POINT_SIZE_OPTIONS = [2, 3, 4, 5, 6, 8, 10, 12, 14, 16, 18, 20].map((v) => ({ value: v }));
export const LINE_WIDTH_OPTIONS = [0.5, 1, 1.5, 2, 2.5, 3, 4, 5, 6, 8].map((v) => ({ value: v }));
export const STROKE_WIDTH_OPTIONS = [0, 0.5, 1, 1.5, 2, 2.5, 3, 4, 5, 6].map((v) => ({ value: v }));
export const SHAPE_OPTIONS = ['circle', 'square', 'triangle', 'diamond', 'cross'].map((v) => ({ value: v, label: SHAPE_LABELS[v] }));
export const LINE_STYLE_OPTIONS = [
  { value: 'solid', label: 'Solid' },
  { value: 'dashed', label: 'Dashed' },
  { value: 'dotted', label: 'Dotted' }
];
export const FRAME_STYLE_OPTIONS = [
  { value: 'offset', label: 'Offset' },
  { value: 'box', label: 'Box' },
  { value: 'l-shape', label: 'L-shape' },
  { value: 'none', label: 'None' }
];
