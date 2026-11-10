import { element } from './artwork.mjs';

function drawTicks(marks, horizontal, origin, scale, length, thickness) {
  // Choose a round label interval with at least 50 screen pixels between labels.
  const target = 50 / scale, power = 10 ** Math.floor(Math.log10(target));
  const multiple = [1, 2, 5, 10].find(value => value * power >= target);
  const divisions = multiple === 2 ? 4 : 5;
  const step = multiple * power / divisions, spacing = step * scale;
  const ticks = [], labels = [];
  for (let index = Math.ceil(-origin / spacing); index <= Math.floor((length - origin) / spacing); index++) {
    const offset = origin + index * spacing, major = index % divisions === 0;
    const depth = major ? 6 : 3;
    ticks.push(horizontal ? `M${offset} ${thickness - depth}v${depth}` : `M${thickness - depth} ${offset}h${depth}`);
    if (!major) continue;
    const value = String(index * step), margin = value.length * 3;
    if (offset < margin || offset > length - margin) continue;
    const anchor = { 'text-anchor': 'middle' };
    labels.push(element('text', horizontal ? { ...anchor, x: offset, y: thickness - 8 }
      : { ...anchor, transform: `translate(${thickness - 8} ${offset}) rotate(-90)` }, value));
  }
  marks.replaceChildren(element('path', { d: ticks.join(' '), fill: 'none' }), ...labels);
}

export function createCanvasRulers(stage) {
  const window = stage.ownerDocument.defaultView;
  const axes = [...stage.parentElement.querySelectorAll('[data-ruler-axis]')].map(ruler => ({
    ruler, horizontal: ruler.dataset.rulerAxis === 'x', marks: ruler.querySelector('.canvas-ruler-marks'),
    cursor: ruler.querySelector('.canvas-ruler-cursor'), geometry: []
  }));
  let frame = 0, pointer = null;
  function render() {
    frame = 0;
    const matrix = stage.querySelector(':scope > svg')?.getScreenCTM();
    const bounds = stage.getBoundingClientRect(), width = stage.clientWidth, height = stage.clientHeight;
    const x = pointer ? pointer.x - bounds.left : -1, y = pointer ? pointer.y - bounds.top : -1;
    const showCursor = matrix && x >= 0 && x < width && y >= 0 && y < height && !stage.inert;
    for (const axis of axes) {
      const { horizontal, ruler, marks, cursor } = axis;
      cursor.toggleAttribute('hidden', !showCursor);
      if (!matrix || !width || !height) continue;
      const origin = horizontal ? matrix.e - bounds.left : matrix.f - bounds.top;
      const scale = horizontal ? matrix.a : matrix.d;
      const length = horizontal ? width : height;
      const thickness = horizontal ? ruler.clientHeight : ruler.clientWidth;
      const geometry = [origin, scale, length, thickness];
      if (scale > 0 && thickness > 0 && geometry.some((value, index) => value !== axis.geometry[index])) {
        drawTicks(marks, horizontal, ...geometry);
        axis.geometry = geometry;
      }
      if (showCursor) cursor.setAttribute('d', horizontal ? `M${x} 0V${thickness}` : `M0 ${y}H${thickness}`);
    }
  }
  function update() {
    if (!frame) frame = window.requestAnimationFrame(render);
  }
  function track(event) {
    if (!event.isPrimary || event.pointerType === 'touch') return;
    pointer = { x: event.clientX, y: event.clientY };
    update();
  }
  function clear() { pointer = null; update(); }
  stage.addEventListener('pointerenter', track);
  stage.addEventListener('pointermove', track);
  stage.addEventListener('pointerleave', clear);
  stage.addEventListener('pointercancel', clear);
  stage.addEventListener('scroll', update, { passive: true });
  window.addEventListener('blur', clear);
  return { update };
}
