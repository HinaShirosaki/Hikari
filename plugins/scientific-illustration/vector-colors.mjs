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
