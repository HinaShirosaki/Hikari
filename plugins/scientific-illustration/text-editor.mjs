// Keep the input outside the SVG so selection redraws do not interrupt typing.
// Its screen transform follows the label through canvas zoom, pan and rotation.
export function createCanvasTextEditor({ getContext, save, status }) {
  let session = null;
  // Measure HTML text with the same font settings as the input. Canvas text
  // measurement enables optical sizing, which underestimates some Inter labels.
  const surface = document.createElement('div'), measure = document.createElement('span'), baseline = document.createElement('span');
  surface.setAttribute('aria-hidden', 'true');
  Object.assign(surface.style, { position: 'fixed', width: '0', height: '0', overflow: 'hidden', visibility: 'hidden', pointerEvents: 'none' });
  Object.assign(measure.style, { display: 'inline-block', width: 'max-content', whiteSpace: 'pre',
    fontOpticalSizing: 'none', fontKerning: 'normal', fontSynthesis: 'style' });
  Object.assign(baseline.style, { display: 'inline-block', width: '0', height: '0', verticalAlign: 'baseline' });
  surface.append(measure); document.body.append(surface);

  function close({ focus = false } = {}) {
    if (!session) return;
    const { input, stage, id } = session;
    session = null;
    input.remove();
    stage.querySelector(`[data-object-id="${id}"] text`)?.style.removeProperty('visibility');
    if (focus) stage.focus({ preventScroll: true });
  }

  function layout() {
    if (!session) return;
    const { input, stage, id } = session;
    const object = getContext().state?.objects.find(object => object.id === id);
    const group = stage.querySelector(`[data-object-id="${id}"]`), text = group?.querySelector('text');
    const matrix = group?.getScreenCTM();
    if (!object || !text || !matrix) { close(); return; }
    const scale = Math.hypot(matrix.a, matrix.b), padding = 4 / scale;
    const lines = input.value.split('\n'), lineHeight = object.fontSize * 1.2;
    const font = { fontFamily: object.fontFamily, fontSize: `${object.fontSize}px`,
      fontWeight: String(object.fontWeight), fontStyle: object.italic ? 'italic' : 'normal', lineHeight: `${lineHeight}px` };
    Object.assign(measure.style, font);
    measure.replaceChildren(baseline, document.createTextNode(input.value));
    const measured = measure.getBoundingClientRect();
    const firstBaseline = baseline.getBoundingClientRect().top - measured.top;
    const width = Math.max(48 / scale, measured.width);
    const height = lines.length * lineHeight;
    const x = Number(text.getAttribute('x')) - width * ({ start: 0, middle: 0.5, end: 1 }[object.align]);
    const y = object.anchor === 'top' ? 0 : object.anchor === 'middle' ? (object.height - height) / 2 : object.height - height;
    const transform = matrix.translate(x - padding, y + object.fontSize - firstBaseline - padding);
    // The font shorthand resets optical sizing and kerning, changing variable
    // fonts such as Inter when switching from SVG to the editing field.
    Object.assign(input.style, { ...font, color: object.color,
      textAlign: { start: 'left', middle: 'center', end: 'right' }[object.align],
      textDecoration: object.underline ? 'underline' : 'none', padding: `${padding}px`,
      width: `${width + padding * 2 + 1}px`, height: `${height + padding * 2}px`,
      transform: `matrix(${transform.a},${transform.b},${transform.c},${transform.d},${transform.e},${transform.f})` });
    text.style.visibility = 'hidden';
  }

  async function commit({ focus = false } = {}) {
    const current = session;
    if (!current || current.saving) return;
    if (current.input.value === current.original) { close({ focus }); return; }
    current.saving = true; current.input.readOnly = true;
    const { state, illustrationId } = getContext();
    try {
      const result = await save({ id: current.id, text: current.input.value, revision: state.revision, illustrationId });
      if (session !== current) return;
      if (result?.ok) close({ focus });
      else {
        current.saving = false; current.input.readOnly = false;
        current.input.focus({ preventScroll: true });
      }
    } catch (error) {
      status(error.message);
      if (session === current) {
        current.saving = false; current.input.readOnly = false;
        current.input.focus({ preventScroll: true });
      }
    }
  }

  function open(id) {
    if (session?.id === id) { session.input.focus({ preventScroll: true }); return true; }
    const { state, illustrationId } = getContext();
    const object = state?.objects.find(object => object.id === id);
    const stage = document.getElementById('main-canvas');
    if (object?.type !== 'text' || !stage.querySelector(`[data-object-id="${id}"] text`)) return false;
    close();
    const input = document.createElement('textarea');
    input.id = 'canvas-text-editor'; input.className = 'canvas-text-editor';
    input.setAttribute('aria-label', 'Edit label text'); input.maxLength = 3000;
    input.title = 'Enter to save · Shift+Enter for a new line · Escape to cancel';
    input.wrap = 'off'; input.value = object.text;
    session = { id, illustrationId, stage, input, original: object.text, saving: false };
    input.addEventListener('input', layout);
    input.addEventListener('keydown', event => {
      event.stopPropagation();
      if (event.isComposing || event.keyCode === 229) return;
      if (event.key === 'Escape') { event.preventDefault(); close({ focus: true }); }
      else if (event.key === 'Enter' && (!event.shiftKey || event.metaKey || event.ctrlKey)) {
        event.preventDefault(); void commit({ focus: true });
      }
    });
    input.addEventListener('blur', () => void commit());
    document.body.append(input); layout();
    input.focus({ preventScroll: true }); input.select();
    return true;
  }

  function sync(next, illustrationId) {
    if (!session) return;
    const object = next.objects.find(object => object.id === session.id);
    if (illustrationId !== session.illustrationId || object?.type !== 'text' || !object.visible
      || object.text !== session.original && !(session.saving && object.text === session.input.value)) {
      close();
    }
  }
  document.addEventListener('pointerdown', event => {
    if (session && !session.input.contains(event.target)) void commit();
  }, true);
  document.addEventListener('scroll', layout, true);
  window.addEventListener('resize', layout);
  return { open, layout, sync, close, isActive: () => Boolean(session) };
}
