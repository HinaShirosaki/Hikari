export const RESIZE_HANDLES = {
  nw: [-1, -1], n: [0, -1], ne: [1, -1], e: [1, 0],
  se: [1, 1], s: [0, 1], sw: [-1, 1], w: [-1, 0]
};

export function scaleTextObject(object, factor) {
  // Clamp a single scale so dimensions and typography reach their limits
  // together without changing the label's proportions.
  const minimum = Math.max(1 / object.width, 1 / object.height, 4 / object.fontSize);
  const maximum = Math.min(8000 / object.width, 8000 / object.height, 300 / object.fontSize);
  const scale = Math.min(maximum, Math.max(minimum, factor));
  return {
    width: Math.min(8000, Math.max(1, object.width * scale)),
    height: Math.min(8000, Math.max(1, object.height * scale)),
    fontSize: Math.min(300, Math.max(4, object.fontSize * scale))
  };
}

export function resizeObject(object, direction, dx, dy) {
  const [horizontal, vertical] = RESIZE_HANDLES[direction];
  const angle = object.rotation * Math.PI / 180, cos = Math.cos(angle), sin = Math.sin(angle);
  const localX = dx * cos + dy * sin, localY = -dx * sin + dy * cos;
  let size;
  if (object.type === 'text') {
    // Project a corner drag onto its original diagonal. Edge drags scale
    // from their active axis, keeping the opposite edge midpoint fixed.
    const factor = horizontal && vertical
      ? 1 + (horizontal * localX * object.width + vertical * localY * object.height) / (object.width ** 2 + object.height ** 2)
      : 1 + (horizontal ? horizontal * localX / object.width : vertical * localY / object.height);
    size = scaleTextObject(object, factor);
  } else {
    size = {
      width: horizontal ? Math.min(8000, Math.max(1, object.width + horizontal * localX)) : object.width,
      height: vertical ? Math.min(8000, Math.max(1, object.height + vertical * localY)) : object.height
    };
  }
  const { width, height } = size;
  const dw = width - object.width, dh = height - object.height;
  // Move the rotated center by half the actual size change, keeping the
  // opposite edge/corner fixed even when a dimension reaches its limit.
  return { ...size,
    x: object.x + (horizontal * dw * cos - vertical * dh * sin - dw) / 2,
    y: object.y + (horizontal * dw * sin + vertical * dh * cos - dh) / 2 };
}

export function resizeCursor(direction, rotation) {
  const [x, y] = RESIZE_HANDLES[direction];
  const angle = Math.atan2(y, x) * 180 / Math.PI + rotation;
  const index = ((Math.round(angle / 45) % 4) + 4) % 4;
  return ['ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize'][index];
}
