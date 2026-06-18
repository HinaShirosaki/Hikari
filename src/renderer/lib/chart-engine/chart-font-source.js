const COMMON_FONTS = [
  'Arial',
  'Helvetica',
  'Helvetica Neue',
  'Times New Roman',
  'Times',
  'Georgia',
  'Courier New',
  'Courier',
  'Verdana',
  'Tahoma',
  'Trebuchet MS',
  'Palatino',
  'Garamond',
  'Bookman',
  'Comic Sans MS',
  'Impact',
  'Lucida Console',
  'Lucida Sans Unicode',
  'Geneva',
  'Monaco',
  'Menlo',
  'Consolas',
  'Segoe UI',
  'Roboto',
  'Open Sans',
  'San Francisco',
  'SF Pro Text',
  'Cambria',
  'Calibri',
  'Optima'
];

let cachedFonts = null;
let pendingLoad = null;

function uniqueSorted(names) {
  const set = new Set();
  names.forEach((name) => {
    const trimmed = String(name || '').trim();
    if (trimmed) set.add(trimmed);
  });
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

async function loadFonts() {
  const fallback = uniqueSorted(COMMON_FONTS);
  if (typeof window === 'undefined') return fallback;
  if (typeof window.queryLocalFonts !== 'function') return fallback;
  try {
    const data = await window.queryLocalFonts();
    const families = data.map((entry) => entry.family);
    const merged = uniqueSorted(families.concat(COMMON_FONTS));
    return merged.length ? merged : fallback;
  } catch (err) {
    return fallback;
  }
}

export function getCachedFonts() {
  return cachedFonts || uniqueSorted(COMMON_FONTS);
}

export function loadSystemFonts() {
  if (cachedFonts) return Promise.resolve(cachedFonts);
  if (!pendingLoad) {
    pendingLoad = loadFonts().then((list) => {
      cachedFonts = list;
      pendingLoad = null;
      return list;
    });
  }
  return pendingLoad;
}
