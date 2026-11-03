// Successful discovery is shared across canvas frames. A failed or empty read
// is retried when a picker is opened again rather than cached for the session.
const fontLoads = new WeakMap();

export function listCanvasFonts(windowObject) {
  if (typeof windowObject?.queryLocalFonts !== 'function') {
    throw new Error('System font discovery is unavailable in this Hikari version.');
  }
  if (!fontLoads.has(windowObject)) {
    const load = Promise.resolve().then(() => windowObject.queryLocalFonts()).then(fonts => {
      const families = new Map();
      for (const font of fonts) {
        const family = typeof font?.family === 'string' ? font.family.trim() : '';
        if (family && family.length <= 100 && !families.has(family.toLowerCase())) families.set(family.toLowerCase(), family);
      }
      const result = { families: [...families.values()].sort((a, b) => a.localeCompare(b)) };
      if (!result.families.length) fontLoads.delete(windowObject);
      return result;
    }).catch(error => { fontLoads.delete(windowObject); throw error; });
    fontLoads.set(windowObject, load);
  }
  return fontLoads.get(windowObject);
}
