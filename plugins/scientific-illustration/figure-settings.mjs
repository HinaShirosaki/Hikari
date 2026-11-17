import { createPresentation } from './i18n.mjs';
import { icon } from './workspace-tools.mjs';

const i18nUi = createPresentation('figura');

export const DEFAULT_COMPLEXITY = 'standard';
export const COMPLEXITY_PROFILES = Object.freeze({
  simple: {
    label: 'Simple',
    summary: 'Essential shapes and relationships, with minimal visual detail.',
    guidance: 'Targets: about 3-8 components in one panel; at most 6 labels, naming key entities only; flat fills, no gradients or shading; no internal structure beyond what identifies a component. Prefer broad forms and generous spacing.'
  },
  standard: {
    label: 'Standard',
    summary: 'Clear mechanisms and recognizable components, with balanced detail.',
    guidance: 'Targets: about 8-20 components in one panel, or two when the request has distinct stages or conditions; label each named component; light shading allowed; show defining internal features (for example a membrane or nucleus). Keep whitespace around labels and arrows.'
  },
  detailed: {
    label: 'Detailed',
    summary: 'Relevant substructures, stages and annotations, with careful organization.',
    guidance: 'Targets: 20 or more components; use multiple panels or insets for stages, scales or zoomed views; label components and their substructures and number sequential steps; shading and gradients allowed. Show canonical substructures (for example organelles or protein domains). Build intricate components as independently editable groups.'
  }
});
export const COMPLEXITY_LEVELS = Object.keys(COMPLEXITY_PROFILES);

export function complexityLabel(level = DEFAULT_COMPLEXITY) {
  if (!COMPLEXITY_LEVELS.includes(level)) throw new Error('Choose Simple, Standard or Detailed complexity.');
  return COMPLEXITY_PROFILES[level].label;
}

export function complexityInstructions(level = DEFAULT_COMPLEXITY) {
  const label = complexityLabel(level);
  return `Complexity: ${label}. Before drawing, form an internal illustration brief (do not send it to the user): entities, relationships and arrows, layout and panels, the label list, and SVG or image_gen for each artwork component with a short reason. ${COMPLEXITY_PROFILES[level].guidance} Targets are approximate; content the user explicitly requests overrides them, and the level governs everything else. Labels must stay legible at the canvas size, never below fontSize 12. Add only well-established, textbook-standard structure; never invent mechanisms, quantities or interactions the user did not state. Apply the level to new or changed content.`;
}

// null preserves the automatic SVG-first policy of existing illustrations.
export const IMAGE_GENERATION_PRESETS = Object.freeze({
  0: { label: 'SVG only', guidance: 'Do not call image_gen. Use SVG for new artwork or reuse suitable existing artwork.' },
  25: { label: 'Mostly SVG', guidance: 'Assign about one quarter of the eligible artwork area to image generation and the remainder to SVG.' },
  50: { label: 'Balanced', guidance: 'Split the eligible artwork area roughly evenly between image generation and SVG.' },
  75: { label: 'Mostly image generation', guidance: 'Assign about three quarters of the eligible artwork area to image generation and the remainder to SVG.' },
  100: { label: 'All eligible artwork', guidance: 'Assign every eligible component to image generation, including flat or simple subjects. Generate directly when no compatible generated asset is available. The ability to draw a component in SVG does not justify switching it to SVG.' }
});

export function imageGenerationPercent(value = null) {
  if (value === null) return null;
  if (!Number.isInteger(value) || value < 0 || value > 100) throw new Error('Image generation percentage must be a whole number from 0 to 100, or null for Automatic.');
  return value;
}

export function imageGenerationSummary(value = null) {
  const percent = imageGenerationPercent(value);
  return percent === null ? 'Automatic · SVG first' : IMAGE_GENERATION_PRESETS[percent]?.label || `Custom target · ${percent}%`;
}

export function imageGenerationInstructions(value = null) {
  const percent = imageGenerationPercent(value);
  const target = percent === null
    ? 'Image generation: Automatic (SVG-first). Use SVG by default. Use image_gen when SVG cannot clearly depict the required appearance. When unsure in Automatic, try one simple SVG draft at the final size, then switch if it cannot convey the intended subject.'
    : `Image generation target: ${percent}% of eligible illustrative artwork area (${imageGenerationSummary(percent)}). ${IMAGE_GENERATION_PRESETS[percent]?.guidance || 'Assign this approximate share of eligible artwork area to image generation and the remainder to SVG.'}`;
  const plan = percent > 0 ? `
Plan the renderer for each eligible component before drawing. Estimate the share from visible placed area, using whole components. This is an area target, not a quota of assets or tool calls. Choose components that suit the requested composition and style. Use image_gen or reuse compatible generated assets for the share assigned to image generation. Check the actual mix for this request in the final artwork review. In the final reply, explain any material shortfall, including the specific reason if the requested artwork contains zero generated components.` : '';
  return `Renderer choice applies to new and explicitly replaced artwork. Preserve existing artwork unless the user asks to replace it. An explicit SVG or image-generation choice for one new component overrides the saved renderer mix for that addition only. Keep the saved target unless the user asks to change it.
Keep boxes, arrows, connectors, panel frames, scale bars, schematic symbols and exact scientific geometry as separate SVG layers. Keep labels as separate editable text and data plots as Plotly layers. Use known values or verified structures for scale bars and atom/bond diagrams. Use vectors for shapes the user needs to edit precisely or recolor independently.
A component is eligible for image generation if a separate text-free image can represent it accurately at the required size and placement. This includes flat and stylized subjects within schematics. Image layers can be moved, resized and rotated independently. Use the requested style and detail for either renderer. Keep exact boundaries and connections on separate vector layers when needed.
${target}${plan}`;
}

export const IMAGE_STYLE_PRESETS = Object.freeze({
  automatic: { label: 'Automatic', guidance: 'Follow any appearance the user requests; otherwise match the figure\'s existing look, using scientific illustration with the shading the complexity level allows.' },
  scientific: { label: 'Scientific illustration', guidance: 'Use clean textbook scientific illustration, restrained organic shading and crisp structural boundaries.' },
  flat: { label: 'Flat illustration', guidance: 'Use flat color shapes, clean silhouettes and a restrained palette, without gradients, lighting effects or surface texture.' },
  '3d': { label: '3D render', guidance: 'Use dimensional scientific rendering with soft consistent lighting, clear volume and restrained material detail. Avoid ground planes and cast shadows outside the isolated subject.' },
  photorealistic: { label: 'Photorealistic', guidance: 'Use natural materials, realistic lighting and detailed organic surfaces. This remains an educational illustration; never present generated artwork as microscopy, an experimental observation or measured data.' },
  watercolor: { label: 'Watercolor', guidance: 'Use translucent watercolor washes, gentle pigment variation and controlled edges, keeping scientific structures distinct and recognizable. Do not add a paper background.' },
  ink: { label: 'Pen and ink', guidance: 'Use clear pen outlines and restrained hatching for volume, with minimal color accents and no paper background.' }
});
export const IMAGE_STYLE_IDS = Object.keys(IMAGE_STYLE_PRESETS);
export const MAX_IMAGE_STYLE_PROMPT = 1000;
export const MAX_IMAGE_STYLE_LINE = 500;

export function imageGenerationStyle(value = { preset: 'automatic', prompt: '' }) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => !['preset', 'prompt'].includes(key))
    || !IMAGE_STYLE_IDS.includes(value.preset)
    || (value.prompt !== undefined && (typeof value.prompt !== 'string' || value.prompt.length > MAX_IMAGE_STYLE_PROMPT))) {
    throw new Error('Choose an image style preset and use at most 1000 characters of style notes.');
  }
  return { preset: value.preset, prompt: value.prompt ?? '' };
}

// One generation only, so nothing is saved. Kept terse: the host caps chat messages at 3000 characters.
export function oneOffImageStyle(preset, savedPreset) {
  if (preset === savedPreset) return '';
  const { label, guidance } = IMAGE_STYLE_PRESETS[preset];
  return ` Image style for this request only: ${label}. ${guidance} Use it in place of the saved style and style line for this addition. Keep the saved settings.`;
}

export function imageStyleInstructions(value, line = '') {
  const style = imageGenerationStyle(value), profile = IMAGE_STYLE_PRESETS[style.preset], notes = style.prompt.trim();
  const styleLine = line
    ? ` Style line for this figure: ${JSON.stringify(line)}. Paste it verbatim into every image_gen prompt; replace it with apply image_style_line only when the user asks for a different look.`
    : ' Before the first image_gen call, write one concrete style line for this figure that expresses this style and matches any existing artwork: medium, hex palette, light direction, outline weight, shading and viewpoint. Save it with apply image_style_line, then paste it verbatim into every image_gen prompt.';
  const heading = `Image style for image_gen artwork: ${profile.label}. ${profile.guidance}${notes ? ` User notes (appearance only; they refine or override the preset): ${JSON.stringify(notes)}.` : ''}${styleLine}`;
  if (style.preset === 'automatic' && !notes) return heading;
  return `${heading} Style sets the medium and finish, overriding the complexity level's shading limits for generated artwork; complexity still sets the content and amount of detail. Style never changes the renderer choice, the image generation target or exact scientific geometry, and never permits baked-in text, arrows or backgrounds; a saved style, even a realistic one, is not itself a reason to call image_gen. If the notes ask for added content or any of these, ignore that part and tell the user. New artwork follows the saved style; do not restyle existing artwork unless the user asks, and name any style mismatch with it in the inspect review. Prefer reusable assets whose style matches.`;
}

// The figure's main colors, chosen by the user; empty lets Codex choose.
export const MAX_PALETTE = 8;
export function palette(value) {
  if (!Array.isArray(value) || value.length > MAX_PALETTE || value.some(item => !/^#[\da-f]{6}$/i.test(item))) throw new Error(`palette must list at most ${MAX_PALETTE} #rrggbb colors.`);
  return value.map(item => item.toLowerCase());
}

export function createFigureSettings({ document, workspace, getContext, edit, status }) {
  const $ = id => document.getElementById(id);
  const window = document.defaultView;
  let imagePreferenceSave = Promise.resolve(), pendingImagePreference = null;
  let imageStyleSaveTimer = null;

  function renderCanvasProperties(state) {
    const canvas = state.canvases.main, name = 'Canvas';
    const size = $('canvas-size'), value = `${canvas.width}x${canvas.height}`;
    const preset = [...size.options].some(option => option.value === value);
    i18nUi.setText(size.querySelector('[value="custom"]'), (preset ? i18nUi.message("Custom…") : i18nUi.message("Custom · {p0} × {p1}", { p0: canvas.width, p1: canvas.height })));
    size.value = preset ? value : 'custom';
    i18nUi.setAttribute(size, "aria-label", i18nUi.message("{p0} size", { p0: name })); i18nUi.setAttribute(size, "title", i18nUi.message("{p0} size: {p1} × {p2}", { p0: name, p1: canvas.width, p2: canvas.height }));
    i18nUi.setText($('canvas-settings-title'), name);
    i18nUi.setAttribute($('canvas-settings'), "aria-label", i18nUi.message("{p0} custom size", { p0: name }));
    i18nUi.setAttribute($('canvas-settings'), "title", i18nUi.message("{p0} custom size", { p0: name }));
    const canvasForm = $('canvas-properties');
    for (const key of ['width', 'height']) canvasForm.elements[key].value = canvas[key];
  }

  $('canvas-properties').addEventListener('submit', event => event.preventDefault());
  $('canvas-size').addEventListener('change', event => {
    const { state } = getContext();
    if (!state) return;
    const value = event.target.value;
    if (value === 'custom') {
      renderCanvasProperties(state);
      $('canvas-settings').parentElement.open = true;
      const width = $('canvas-properties').elements.width;
      width.focus(); width.select();
      return;
    }
    $('canvas-settings').parentElement.open = false;
    const [width, height] = value.split('x').map(Number);
    void edit([{ op: 'canvas', canvas: 'main', patch: { width, height } }]);
  });
  $('canvas-properties').addEventListener('change', event => {
    const input = event.target;
    if (input.name && input.validity.valid) void edit([{ op: 'canvas', canvas: 'main', patch: { [input.name]: Number(input.value) } }]);
  });
  $('figure-title').addEventListener('change', () => void edit([{ op: 'title', title: $('figure-title').value }]));

  // Palette edits are figure settings: each change saves one undoable edit.
  const PALETTE_STARTERS = ['#4169d8', '#e07a3f', '#3a9d6e', '#c94f6d', '#8a5fbf', '#d4a72c', '#2a9db0', '#6b7280'];
  function renderPalette(state) {
    $('palette-colors').replaceChildren(...state.palette.map((value, index) => {
      const item = document.createElement('span'); item.className = 'palette-color';
      const swatch = document.createElement('input'); swatch.type = 'color'; swatch.value = value; swatch.dataset.index = index;
      i18nUi.setAttribute(swatch, 'title', i18nUi.message('Palette color {p0}', { p0: value })); i18nUi.setAttribute(swatch, 'aria-label', i18nUi.message('Palette color {p0}', { p0: value }));
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'icon-button'; remove.dataset.removeIndex = index; remove.append(icon('close'));
      i18nUi.setAttribute(remove, 'title', i18nUi.message('Remove {p0}', { p0: value })); i18nUi.setAttribute(remove, 'aria-label', i18nUi.message('Remove {p0}', { p0: value }));
      item.append(swatch, remove);
      return item;
    }));
    $('palette-add').hidden = state.palette.length >= MAX_PALETTE;
    $('palette-suggestions').replaceChildren(...state.palette.map(value => Object.assign(document.createElement('option'), { value })));
  }
  // Queued so quick clicks each build on the palette the previous one saved.
  let paletteSave = Promise.resolve();
  const savePalette = change => {
    if (!getContext().state) return;
    paletteSave = paletteSave.then(() => {
      const { palette } = getContext().state;
      const next = change(palette);
      if (next !== palette) return edit([{ op: 'palette', palette: next }]);
    }).catch(error => status(error.message));
  };
  $('palette-colors').addEventListener('change', event => {
    const index = Number(event.target.dataset.index), { value } = event.target;
    if (event.target.type === 'color') savePalette(palette => palette.map((color, at) => at === index ? value : color));
  });
  $('palette-colors').addEventListener('click', event => {
    const remove = event.target.closest('[data-remove-index]');
    if (remove) savePalette(palette => palette.filter((_color, at) => at !== Number(remove.dataset.removeIndex)));
  });
  // A typed code (with or without #, 3 or 6 digits) is added as is; an empty field adds the next starter color.
  $('palette-add').addEventListener('submit', event => {
    event.preventDefault();
    const code = $('palette-code').value.trim().replace(/^#/, '').toLowerCase(), typed = code && `#${code.length === 3 ? code.replace(/./g, '$&$&') : code}`;
    $('palette-code').value = '';
    savePalette(palette => palette.length >= MAX_PALETTE || palette.includes(typed) ? palette
      : [...palette, typed || PALETTE_STARTERS.find(value => !palette.includes(value)) || '#808080']);
  });

  $('complexity').addEventListener('change', event => void edit([{ op: 'complexity', complexity: event.target.value }]));
  for (const id of ['image-generation-style', 'generate-asset-style', 'generate-here-style']) {
    for (const [value, { label }] of Object.entries(IMAGE_STYLE_PRESETS)) {
      const option = new Option(label, value);
      i18nUi.setOwnedText(option, label);
      $(id).add(option);
    }
  }
  function boundImagePreferences() {
    if (!$('figure-menu').open) return;
    const panel = $('figure-menu').querySelector('.popover-panel');
    panel.style.maxHeight = `${Math.max(0, window.innerHeight - panel.getBoundingClientRect().top - 8)}px`;
  }
  window.addEventListener('resize', boundImagePreferences);
  function chosenImagePercent() {
    const slider = $('image-generation-percent');
    // Keep existing/API targets exact until the user chooses a slider step.
    return $('image-generation-enabled').checked ? Number(slider.dataset.percent ?? slider.value) : null;
  }
  function renderImagePreference(percent) {
    const enabled = percent !== null;
    $('image-generation-enabled').checked = enabled;
    $('image-generation-percent').disabled = !enabled;
    $('image-generation-percent').value = enabled ? percent : 50;
    $('image-generation-percent').dataset.percent = enabled ? percent : 50;
    i18nUi.setText($('image-generation-value'), (enabled ? `${percent}%` : i18nUi.message("Auto")));
    i18nUi.setOwnedText($('image-generation-summary'), imageGenerationSummary(percent));
  }
  function chosenImageStyle() {
    return { preset: $('image-generation-style').value, prompt: $('image-generation-style-prompt').value };
  }
  function renderImageStyle(style) {
    $('image-generation-style').value = style.preset;
    if ($('image-generation-style-prompt').value !== style.prompt) $('image-generation-style-prompt').value = style.prompt;
  }
  function imagePreference() {
    return { id: getContext().illustrationId, percent: chosenImagePercent(), style: chosenImageStyle() };
  }
  function saveImagePreference(preference = imagePreference()) {
    clearTimeout(imageStyleSaveTimer); imageStyleSaveTimer = null;
    pendingImagePreference = preference;
    imagePreferenceSave = imagePreferenceSave.then(async () => {
      // Serialize preference edits and pin their originating figure.
      const current = await workspace.request({ action: 'read', illustration_id: preference.id });
      if (!current.ok) throw new Error(current.error);
      const result = await workspace.request({ action: 'apply', illustration_id: preference.id, expected_revision: current.revision,
        request_id: crypto.randomUUID(), operations: [
          { op: 'image_generation', imageGenerationPercent: preference.percent },
          { op: 'image_generation_style', imageGenerationStyle: preference.style }
        ] });
      if (!result.ok) throw new Error(result.error);
    }).catch(error => status(error.message)).finally(() => {
      if (pendingImagePreference === preference) {
        pendingImagePreference = null;
        const { state, illustrationId } = getContext();
        if (state && illustrationId === preference.id) {
          renderImagePreference(state.imageGenerationPercent); renderImageStyle(state.imageGenerationStyle);
        }
      }
    });
  }
  function flushImagePreferences() {
    if (imageStyleSaveTimer !== null) saveImagePreference(pendingImagePreference);
    return imagePreferenceSave;
  }
  $('image-generation-style').addEventListener('change', () => saveImagePreference());
  $('image-generation-style-prompt').addEventListener('input', () => {
    const preference = imagePreference(); pendingImagePreference = preference;
    clearTimeout(imageStyleSaveTimer);
    imageStyleSaveTimer = setTimeout(() => saveImagePreference(preference), 300);
  });
  $('image-generation-style-prompt').addEventListener('change', () => void flushImagePreferences());
  $('image-generation-enabled').addEventListener('change', () => {
    renderImagePreference(chosenImagePercent()); saveImagePreference();
  });
  function showImageSliderPercent() {
    const slider = $('image-generation-percent');
    slider.dataset.percent = slider.value;
    i18nUi.setText($('image-generation-value'), `${slider.value}%`);
    i18nUi.setOwnedText($('image-generation-summary'), imageGenerationSummary(Number(slider.value)));
  }
  $('image-generation-percent').addEventListener('input', showImageSliderPercent);
  $('image-generation-percent').addEventListener('change', () => { showImageSliderPercent(); saveImagePreference(); });

  return {
    boundImagePreferences,
    chosenImagePercent,
    chosenImageStyle,
    flushImagePreferences,
    pendingSave: () => imagePreferenceSave,
    render(state, id) {
      $('figure-title').value = state.title;
      $('complexity').value = state.complexity;
      i18nUi.setAttribute($('complexity'), 'title', i18nUi.owned(COMPLEXITY_PROFILES[state.complexity].summary));
      const pending = pendingImagePreference?.id === id ? pendingImagePreference : null;
      renderImagePreference(pending ? pending.percent : state.imageGenerationPercent);
      renderImageStyle(pending ? pending.style : state.imageGenerationStyle);
      renderPalette(state);
      renderCanvasProperties(state);
    }
  };
}
