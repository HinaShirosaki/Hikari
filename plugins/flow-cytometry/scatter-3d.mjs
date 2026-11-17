import { axisProjection } from './analysis.mjs';
import { densityPalette } from './plot.mjs';

const START = { yaw: .56, pitch: .38 };
const PITCH_LIMIT = Math.PI / 2 - .03;
const DRAG_THRESHOLD = 8;
const AXIS_SLOPE = .35;
const KEYS = {
  ArrowLeft: [-.12, 0], ArrowRight: [.12, 0],
  ArrowUp: [0, -.1], ArrowDown: [0, .1]
};
const CORNERS = Array.from({ length: 8 }, (_, index) => [index & 1, (index >> 1) & 1, index >> 2]);
const number = new Intl.NumberFormat('en', { maximumSignificantDigits: 3, notation: 'compact' });
const integer = new Intl.NumberFormat();
const scientific = new Intl.NumberFormat('en', { maximumSignificantDigits: 3, notation: 'scientific' });
const formatTick = value => value !== 0 && Math.abs(value) < .01 ? scientific.format(value) : number.format(value);

function projection(camera, width, height) {
  const cy = Math.cos(camera.yaw), sy = Math.sin(camera.yaw);
  const cp = Math.cos(camera.pitch), sp = Math.sin(camera.pitch);
  const scale = Math.min(width, height) * .53;
  return (x, y, z, target) => {
    x -= .5;
    y -= .5;
    z -= .5;
    const depth = sy * x + cy * y;
    target[0] = width * .5 + scale * (cy * x - sy * y);
    target[1] = height * .5 + scale * (sp * depth - cp * z);
    target[2] = cp * depth + sp * z;
    return target;
  };
}

function drawFrame(context, corners, front) {
  context.strokeStyle = front ? '#202126' : '#aeb2ba';
  context.lineWidth = 1;
  context.beginPath();
  for (let index = 0; index < corners.length; index++) {
    const a = corners[index];
    for (const axis of [1, 2, 4]) {
      if (index & axis) continue;
      const b = corners[index | axis];
      if ((a[2] + b[2] >= 0) !== front) continue;
      context.moveTo(a[0], a[1]);
      context.lineTo(b[0], b[1]);
    }
  }
  context.stroke();
}

function drawPoints(context, { points, intensities, order, colors }, project) {
  const point = [0, 0, 0];
  let previous = -1;
  context.globalAlpha = .75;
  for (const index of order) {
    const at = 3 * index;
    const [x, y, depth] = project(points[at], points[at + 1], points[at + 2], point);
    const size = 1.8 + .9 * depth;
    const intensity = intensities[index];
    if (intensity !== previous) {
      context.fillStyle = colors[intensity];
      previous = intensity;
    }
    context.fillRect(x - size / 2, y - size / 2, size, size);
  }
  context.globalAlpha = 1;
}

function label(context, text, x, y, width, height) {
  const half = context.measureText(text).width / 2;
  x = Math.max(half + 2, Math.min(width - half - 2, x));
  y = Math.max(8, Math.min(height - 8, y));
  // Keep text legible when data or an edge passes behind it.
  context.strokeText(text, x, y);
  context.fillText(text, x, y);
}

function drawAxes(context, corners, axes, width, height) {
  const origin = corners[0];
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillStyle = '#13151a';
  for (const [index, axis] of axes.entries()) {
    const end = corners[1 << index];
    const dx = end[0] - origin[0], dy = end[1] - origin[1];
    const length = Math.hypot(dx, dy);
    if (length < 20) continue;
    // Keep ticks on the same side of their axis as the cube turns.
    const direction = index === 0 ? 1 : -1;
    const nx = -dy / length * direction, ny = dx / length * direction;
    const parts = length >= 105 ? 3 : 1;
    const raw = axisProjection(axis).inverse;
    context.font = '11px Arial';
    for (let tick = 1; tick <= parts; tick++) {
      const fraction = tick / parts;
      const x = origin[0] + fraction * dx, y = origin[1] + fraction * dy;
      context.beginPath();
      context.moveTo(x, y);
      context.lineTo(x + 4 * nx, y + 4 * ny);
      context.strokeStyle = '#202126';
      context.lineWidth = 1;
      context.stroke();
      context.strokeStyle = '#fff';
      context.lineWidth = 3;
      label(context, formatTick(raw(fraction)), x + 13 * nx, y + 13 * ny, width, height);
    }
    context.font = 'bold 12px Arial';
    context.strokeStyle = '#fff';
    context.lineWidth = 3;
    label(context, 'XYZ'[index], end[0] + 14 * dx / length, end[1] + 14 * dy / length, width, height);
  }
}

export function createScatter3D({ canvas, reset, channels, notice, sampling }) {
  const context = canvas.getContext('2d');
  let data = null;
  let drag = null;
  let frame = 0;

  function paint() {
    frame = 0;
    if (!data || canvas.hidden) return;
    const { points, axes, camera } = data;
    const { width, height } = canvas.getBoundingClientRect();
    if (!width || !height) return;
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    const pixelWidth = Math.round(width * ratio), pixelHeight = Math.round(height * ratio);
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }
    context.setTransform(pixelWidth / width, 0, 0, pixelHeight / height, 0, 0);
    context.clearRect(0, 0, width, height);
    const project = projection(camera, width, height);
    const corners = CORNERS.map(([x, y, z]) => project(x, y, z, []));
    drawFrame(context, corners, false);
    if (points.length) drawPoints(context, data, project);
    drawFrame(context, corners, true);
    drawAxes(context, corners, axes, width, height);
  }

  function schedulePaint() {
    if (!frame) frame = requestAnimationFrame(paint);
  }

  function rotate(from, horizontal, vertical) {
    if (!data) return;
    // The near side of the cube follows the pointer. Keeping yaw around
    // the Z axis prevents the cube from rolling during horizontal drags.
    data.camera.yaw = from.yaw - horizontal;
    data.camera.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, from.pitch + vertical));
    schedulePaint();
  }

  function resetView() {
    if (!data) return;
    endDrag();
    Object.assign(data.camera, START);
    schedulePaint();
  }

  function endDrag() {
    if (!drag) return;
    const { id } = drag;
    drag = null;
    canvas.classList.remove('is-rotating');
    if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
  }

  canvas.addEventListener('pointerdown', event => {
    if (!data || drag || event.button !== 0) return;
    canvas.focus({ preventScroll: true });
    canvas.setPointerCapture(event.pointerId);
    drag = {
      id: event.pointerId, x: event.clientX, y: event.clientY,
      start: { ...data.camera },
      radiansPerPixel: Math.PI / canvas.clientWidth,
      axis: null
    };
    canvas.classList.add('is-rotating');
  });
  canvas.addEventListener('pointermove', event => {
    if (drag?.id !== event.pointerId) return;
    const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
    if (!drag.axis) {
      const horizontal = Math.abs(dx), vertical = Math.abs(dy);
      if (Math.max(horizontal, vertical) < DRAG_THRESHOLD) return;
      if (vertical <= horizontal * AXIS_SLOPE) drag.axis = 'horizontal';
      else if (horizontal <= vertical * AXIS_SLOPE) drag.axis = 'vertical';
      else drag.axis = 'both';
    }
    // Use displacement from the start so retracing a drag restores the
    // same angle, even if the gesture previously hit the tilt limit.
    rotate(drag.start,
      drag.axis === 'vertical' ? 0 : dx * drag.radiansPerPixel,
      drag.axis === 'horizontal' ? 0 : dy * drag.radiansPerPixel);
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    canvas.addEventListener(type, event => {
      if (drag?.id === event.pointerId) endDrag();
    });
  }
  canvas.addEventListener('keydown', event => {
    if (!data) return;
    if (event.key === 'Home') resetView();
    else if (Object.hasOwn(KEYS, event.key)) {
      if (!drag) rotate(data.camera, ...KEYS[event.key]);
    } else return;
    event.preventDefault();
  });
  reset.addEventListener('click', resetView);
  new ResizeObserver(schedulePaint).observe(canvas);

  return {
    paintNow() {
      if (frame) cancelAnimationFrame(frame);
      paint();
    },
    show({ points, intensities, visible }, axes, names, camera) {
      camera.yaw ??= START.yaw;
      camera.pitch ??= START.pitch;
      const colors = densityPalette().map(rgb => `rgb(${rgb.join(' ')})`);
      // Draw dense points last so overlapping sparse points don't hide them.
      const order = Uint32Array.from(intensities, (_, index) => index)
        .sort((a, b) => intensities[a] - intensities[b]);
      data = { points, intensities, order, colors, axes, camera };
      const displayed = points.length / 3;
      sampling.hidden = displayed >= visible;
      sampling.textContent = sampling.hidden ? '' : `Showing a sample of ${integer.format(displayed)} points.`;
      this.setChannelLabels(names);
      reset.disabled = false;
      schedulePaint();
    },
    setChannelLabels(names) {
      if (!data) return;
      const labels = data.axes.map((axis, index) => `${'XYZ'[index]}: ${names[axis.channel]}`);
      channels.textContent = labels.join(' · ');
      canvas.setAttribute('aria-label', '3D scatter plot. ' + labels.join(', '));
    },
    clear() {
      endDrag();
      data = null;
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      context.clearRect(0, 0, canvas.width, canvas.height);
      channels.textContent = '';
      sampling.hidden = true;
      canvas.setAttribute('aria-label', '3D scatter plot');
      reset.disabled = true;
    },
    message(message) {
      notice.textContent = message;
      notice.hidden = !message;
    }
  };
}
