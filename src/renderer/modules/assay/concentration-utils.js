export function parseConcentrationMagnitude(value) {
  const text = String(value || '').trim();
  if (!text) {
    return null;
  }
  const match = text.match(/([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)\s*([a-zA-Zµμ]*)/);
  if (!match) {
    return null;
  }
  const numeric = Number(match[1]);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  const rawUnit = String(match[2] || '').toLowerCase().replace('μ', 'u').replace('µ', 'u');
  const scaleMap = {
    fm: 1e-15,
    pm: 1e-12,
    nm: 1e-9,
    um: 1e-6,
    mm: 1e-3,
    cm: 1e-2,
    m: 1,
    gm: 1,
    mg: 1e-3,
    ug: 1e-6,
    ng: 1e-9,
    pg: 1e-12,
    kg: 1e3
  };
  const unit = rawUnit.replace(/\/.*$/, '');
  const scale = scaleMap[unit] || 1;
  return numeric * scale;
}

export function formatDecimal(value) {
  if (!Number.isFinite(value)) {
    return '';
  }
  const absolute = Math.abs(value);
  const decimals = absolute >= 100 ? 1 : absolute >= 10 ? 2 : absolute >= 1 ? 3 : 4;
  return value.toFixed(decimals).replace(/\.?0+$/, '');
}

export function formatVolumeText(value) {
  return Number.isFinite(value) ? `${formatDecimal(value)} uL` : '-';
}
