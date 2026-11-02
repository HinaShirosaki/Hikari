// Recolor a vector layer one color at a time. Works on the validated SVG
// string, where paints are double-quoted presentation attributes.
// ponytail: hex paints only; named colors (white, red) get no swatch. Stored
// artwork is hex apart from none/url(), so add a name table only if imports need it.
const PAINT = /(\s(fill|stroke|stop-color)=")(#[\da-f]{6}|#[\da-f]{3})(?=")/gi;
const swatch = value => /^#[\da-f]{6}$/i.test(value) ? value.toLowerCase()
  : /^#[\da-f]{3}$/i.test(value) ? `#${[...value.slice(1)].map(digit => digit + digit).join('')}`.toLowerCase() : '';

// A layer-wide fill/stroke override hides that channel of the SVG, so its own
// color is the swatch instead.
export function vectorColors(object) {
  const colors = new Set([swatch(object.fill ?? ''), swatch(object.stroke ?? '')]);
  for (const [, , name, value] of object.svg.matchAll(PAINT)) if (object[name] === undefined) colors.add(swatch(value));
  colors.delete('');
  return [...colors];
}

export function recolorVector(object, from, to) {
  const patch = {};
  for (const key of ['fill', 'stroke']) if (swatch(object[key] ?? '') === from) patch[key] = to;
  const svg = object.svg.replace(PAINT, (match, prefix, name, value) => object[name] === undefined && swatch(value) === from ? prefix + to : match);
  if (svg !== object.svg) patch.svg = svg;
  return patch;
}

// While a swatch is being edited, fade every painted shape of the rendered
// artwork that does not use its color and trace the ones that do with marching
// ants. A shape that uses it for only one of fill/stroke fades the other
// channel. The ants are sibling copies, so they share the shape's transforms
// and clipping. Re-rendering the canvas clears both.
export function highlightVectorColor(artwork, color) {
  const rgb = `rgb(${[1, 3, 5].map(index => parseInt(color.slice(index, index + 2), 16)).join(', ')})`;
  const gradientUses = id => [...artwork.ownerDocument.getElementById(id)?.querySelectorAll('stop') ?? []].some(stop => getComputedStyle(stop).stopColor === rgb);
  const uses = paint => paint === rgb || gradientUses(/^url\("?#([^")]+)/.exec(paint)?.[1]);
  for (const shape of artwork.querySelectorAll('path, rect, circle, ellipse, line, polyline, polygon, text')) {
    if (shape.closest('defs, clipPath, mask, pattern, marker')) continue;
    const style = getComputedStyle(shape), fill = uses(style.fill), stroke = uses(style.stroke);
    if (!fill || !stroke) shape.classList.add(fill ? 'color-dim-stroke' : stroke ? 'color-dim-fill' : 'color-dim');
    if (fill || stroke) shape.after(...['color-ants', 'color-ants color-ants-dash'].map(name => {
      const ants = shape.cloneNode(true); ants.removeAttribute('id'); ants.setAttribute('class', name); return ants;
    }));
  }
}
