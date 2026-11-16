const INSTRUCTIONS = {
  freehand: 'Drag around a population and release to close the gate.',
  triangle: 'Click three vertices to close the triangle.',
  circle: 'Drag from the center to the edge of the circle.',
  polygon: 'Click to add vertices. Click the first point or press Enter to close the polygon.',
  vertical: 'Click to place a vertical line and count events on each side.',
  horizontal: 'Click to place a horizontal line and count events above and below.',
  quadrant: 'Click to place the intersection and count events in four quadrants.'
};
const DRAG_TOOLS = new Set(['freehand', 'circle']);
const SPLIT_TOOLS = new Set(['vertical', 'horizontal', 'quadrant']);

function hasArea(points, width, height) {
  if (points.length < 3) return false;
  let area = 0;
  for (const [index, [x, y]] of points.entries()) {
    const [nextX, nextY] = points[(index + 1) % points.length];
    area += x * nextY - y * nextX;
  }
  return Math.abs(area) * width * height >= 30;
}

export function createGateDrawing({ overlay, plot, toolbar, finish, help, save, findGate, selectGate, updateGate }) {
  const buttons = [...toolbar.querySelectorAll('[data-gate-tool]')];
  let tabStop = toolbar.querySelector('[data-gate-tool="freehand"]');
  let kind = null;
  let pointer = null;
  let points = [];
  let drag = null;

  function instructions(message) {
    help.textContent = message ?? (kind ? INSTRUCTIONS[kind] + ' Esc cancels.' : '');
  }

  function setTool(next) {
    const captured = pointer;
    pointer = null;
    kind = next;
    points = [];
    drag = null;
    if (captured !== null && overlay.hasPointerCapture(captured)) overlay.releasePointerCapture(captured);
    if (document.activeElement === finish) tabStop.focus();
    finish.hidden = true;
    overlay.classList.toggle('is-drawing', Boolean(next));
    overlay.classList.remove('is-dragging-gate');
    for (const button of buttons) button.setAttribute('aria-pressed', String(button.dataset.gateTool === next));
    instructions();
    plot.preview(null);
  }

  function commit(shape) {
    const gate = { kind, ...shape };
    setTool(null);
    save(gate);
  }

  function distance(a, b) {
    return Math.hypot((a[0] - b[0]) * overlay.clientWidth, (a[1] - b[1]) * overlay.clientHeight);
  }

  function addFreehandPoint(point) {
    if (distance(point, points.at(-1)) < 3) return;
    points.push(point);
    if (points.length > 480) points = points.filter((_, index) => index % 2 === 0);
  }

  function circleAt(point) {
    const center = points[0];
    return { center, radius: Math.hypot(point[0] - center[0], point[1] - center[1]) };
  }

  function closePolygon() {
    if (hasArea(points, overlay.clientWidth, overlay.clientHeight)) {
      commit({ points });
    } else {
      instructions('The vertices need to enclose an area. Add a point away from the line or press Esc to cancel.');
    }
  }

  function previewAt(point) {
    if (SPLIT_TOOLS.has(kind)) {
      plot.preview({ kind, threshold: point });
    } else if (kind === 'circle' && points.length) {
      plot.preview(circleAt(point));
    } else if (kind === 'freehand' && pointer !== null) {
      addFreehandPoint(point);
      plot.preview({ points, closed: true });
    } else if (points.length) {
      const nearStart = kind === 'polygon' && points.length >= 3 && distance(point, points[0]) <= 9;
      plot.preview({
        points: [...points, nearStart ? points[0] : point],
        closed: kind === 'triangle' && points.length === 2,
        start: kind === 'polygon' && points.length >= 3 ? points[0] : null
      });
    }
  }

  function editShape(point) {
    if (distance(drag.start, point) < 3) return null;
    const { gate, start, handle } = drag;
    return plot.editShape(gate, start, point, handle);
  }

  function editInstructions(gate) {
    if (gate.kind === 'quadrant') return 'Drag either line, or drag the intersection to move both.';
    if (gate.threshold) return 'Drag the line to adjust the split.';
    return 'Drag the gate to move it. Drag a handle to adjust its shape.';
  }

  overlay.addEventListener('pointerdown', event => {
    if (pointer !== null || event.button !== 0) return;
    const point = plot.point(event);
    if (!point) return;
    if (!kind) {
      const hit = plot.gateAt(event, point);
      const gate = hit && findGate(hit.id);
      if (!hit) {
        selectGate(null);
        instructions();
      }
      if (!gate) return;
      drag = { gate, start: point, handle: hit.handle };
    }
    event.preventDefault();
    overlay.setPointerCapture(event.pointerId);
    pointer = event.pointerId;
    if (drag) selectGate(drag.gate.id);
    if (DRAG_TOOLS.has(kind)) points = [point];
  });

  overlay.addEventListener('pointermove', event => {
    if ((!kind && !drag) || (pointer !== null && pointer !== event.pointerId)) return;
    const point = plot.point(event);
    if (!point) return;
    if (drag) {
      const shape = editShape(point);
      overlay.classList.toggle('is-dragging-gate', Boolean(shape));
      plot.previewEdit(drag.gate, shape);
    } else {
      previewAt(point);
    }
  });
  overlay.addEventListener('pointerleave', () => {
    if (kind && pointer === null && SPLIT_TOOLS.has(kind)) plot.preview(null);
  });
  for (const type of ['pointercancel', 'lostpointercapture']) {
    overlay.addEventListener(type, event => {
      if (pointer === event.pointerId) setTool(null);
    });
  }

  overlay.addEventListener('pointerup', event => {
    if (pointer !== event.pointerId) return;
    pointer = null;
    const point = plot.point(event);
    if (!point) {
      setTool(null);
      return;
    }
    if (drag) {
      const { gate } = drag;
      const shape = editShape(point);
      setTool(null);
      if (shape) updateGate(gate, shape);
      else instructions(editInstructions(gate));
    } else if (SPLIT_TOOLS.has(kind)) {
      commit({ threshold: point });
    } else if (kind === 'circle') {
      const shape = circleAt(point);
      if (distance(point, shape.center) >= 4) commit(shape);
      else {
        setTool(kind);
        instructions('Drag farther from the center to draw a circle.');
      }
    } else if (kind === 'freehand') {
      addFreehandPoint(point);
      if (hasArea(points, overlay.clientWidth, overlay.clientHeight)) commit({ points });
      else {
        setTool(kind);
        instructions('Drag around a larger area to draw the gate.');
      }
    } else if (kind === 'polygon' && points.length >= 3 && distance(point, points[0]) <= 9) {
      closePolygon();
    } else if (points.length < 480 && (!points.length || distance(point, points.at(-1)) >= 3)) {
      points.push(point);
      if (kind === 'triangle' && points.length === 3) {
        if (hasArea(points, overlay.clientWidth, overlay.clientHeight)) commit({ points });
        else {
          points.pop();
          instructions('Choose a third vertex away from the line between the first two.');
          previewAt(point);
        }
      } else {
        instructions();
        finish.hidden = kind !== 'polygon' || points.length < 3;
        previewAt(point);
      }
    }
  });

  function setTabStop(button) {
    tabStop.tabIndex = -1;
    tabStop = button;
    tabStop.tabIndex = 0;
  }

  for (const button of buttons) {
    button.addEventListener('focus', () => setTabStop(button));
    button.addEventListener('click', () => {
      setTabStop(button);
      const tool = button.dataset.gateTool;
      setTool(kind === tool ? null : tool);
    });
  }
  toolbar.addEventListener('keydown', event => {
    const index = buttons.indexOf(event.target);
    if (index < 0) return;
    let next;
    switch (event.key) {
      case 'ArrowRight': next = (index + 1) % buttons.length; break;
      case 'ArrowLeft': next = (index + buttons.length - 1) % buttons.length; break;
      case 'Home': next = 0; break;
      case 'End': next = buttons.length - 1; break;
      default: return;
    }
    event.preventDefault();
    buttons[next].focus();
  });
  finish.addEventListener('click', closePolygon);
  window.addEventListener('keydown', event => {
    if ((!kind && !drag) || event.defaultPrevented) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      setTool(null);
    } else if (kind === 'polygon' && points.length >= 3 && event.key === 'Enter'
        && (event.target.dataset?.gateTool === 'polygon' || !event.target.closest?.('button, input, select, textarea'))) {
      event.preventDefault();
      closePolygon();
    }
  });
  return {
    cancel() { setTool(null); },
    setAvailable(available) {
      for (const button of buttons) button.disabled = !available;
    },
    message(message) { if (!kind) instructions(message); }
  };
}
