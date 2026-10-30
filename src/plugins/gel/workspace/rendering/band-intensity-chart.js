import { createPresentation } from "../../i18n.mjs";
const i18nUi = createPresentation("gel");
function axisLabel(value) {
  if (Math.abs(value) >= 1e6) return value.toExponential(1);
  return String(Number(value.toPrecision(3)));
}

// The chart uses the same background-corrected measurements as the table;
// formatting the displayed values never rounds the bar geometry.
export function renderBandIntensityChart(svg, measurements, safeText) {
  if (!svg) return;
  if (measurements.length) svg.removeAttribute('hidden');
  else svg.setAttribute('hidden', '');
  if (!measurements.length) { i18nUi.setHtml(svg, ''); return; }
  const width = Math.max(560, 72 + measurements.length * 68);
  const height = 240, left = 66, right = width - 18, top = 28, bottom = 204;
  const values = measurements.map(row => row.value).filter(Number.isFinite);
  const min = Math.min(0, ...values), max = Math.max(0, ...values);
  const span = max - min || 1;
  const y = value => bottom - (value - min) / span * (bottom - top);
  const zero = y(0), slot = (right - left) / measurements.length;
  const barWidth = Math.min(42, slot * 0.6);
  const grid = Array.from({ length: 5 }, (_, index) => {
    const value = min + span * index / 4, position = y(value);
    return `<line class="gel-intensity-grid" x1="${left}" x2="${right}" y1="${position}" y2="${position}" />
      <text class="gel-intensity-axis" x="${left - 8}" y="${position + 4}" text-anchor="end">${axisLabel(value)}</text>`;
  }).join('');
  const bars = measurements.map((row, index) => {
    const center = left + slot * (index + 0.5), valid = Number.isFinite(row.value);
    const position = valid ? y(row.value) : zero;
    const title = `Lane ${row.lane}${row.label ? ` — ${row.label}` : ''}: ${row.intensity}${row.review ? ' — review background' : ''}`;
    return `<g class="gel-intensity-series" data-lane="${safeText(row.lane)}">
      <title>${safeText(title)}</title>
      ${valid ? `<rect class="gel-intensity-bar" data-review="${Boolean(row.review)}" data-value="${row.value}" x="${center - barWidth / 2}" y="${Math.min(zero, position)}" width="${barWidth}" height="${Math.abs(position - zero)}" rx="2" />` : ''}
      <text class="gel-intensity-value" x="${center}" y="${row.value < 0 ? position + 14 : position - 8}" text-anchor="middle">${safeText(row.intensity)}</text>
      <text class="gel-intensity-axis" x="${center}" y="${height - 10}" text-anchor="middle">${i18nUi.svg("Lane")} ${safeText(row.lane)}</text>
    </g>`;
  }).join('');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(height));
  i18nUi.setHtml(svg, `<title ${i18nUi.textBinding("Background-corrected band intensity by lane")}>${i18nUi.plainText("Background-corrected band intensity by lane")}</title>${grid}
    <line class="gel-intensity-zero" x1="${left}" x2="${right}" y1="${zero}" y2="${zero}" />${bars}`);
}
