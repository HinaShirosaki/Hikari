export const EMPTY_PLOT_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 500"/>';

export function normalizePlotly(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => !['data', 'layout', 'source'].includes(key))
    || !Array.isArray(value.data) || !value.data.length || value.data.length > 100
    || value.data.some(trace => !trace || typeof trace !== 'object' || Array.isArray(trace))
    || value.layout !== undefined && (!value.layout || typeof value.layout !== 'object' || Array.isArray(value.layout))
    || value.source !== undefined && (typeof value.source !== 'string' || value.source.length > 2000)) throw new Error('Plots need plotly:{data:[traces],layout:{...},source:"optional data/processing description"}.');
  const visit = (item, depth = 0) => {
    if (depth > 32) throw new Error('The plot specification is too deeply nested.');
    if (item === null || typeof item === 'string' || typeof item === 'boolean' || typeof item === 'number' && Number.isFinite(item)) return;
    if (!item || typeof item !== 'object' || ![Object.prototype, Array.prototype, null].includes(Object.getPrototypeOf(item))) throw new Error('Plot data must contain JSON values and finite numbers only.');
    Object.values(item).forEach(child => visit(child, depth + 1));
  };
  visit(value);
  if (JSON.stringify(value).length > 2000000) throw new Error('Plot data and layout must be at most 2 million characters.');
  return JSON.parse(JSON.stringify({ data: value.data, layout: value.layout || {}, source: value.source || '' }));
}

export async function preparePlots(next, previous, hikari, validateSvg) {
  for (const object of next.objects.filter(object => object.type === 'plot')) {
    const before = previous.objects.find(item => item.id === object.id);
    if (before?.type === 'plot' && before.width === object.width && before.height === object.height
      && before.svg === object.svg && JSON.stringify(before.plotly) === JSON.stringify(object.plotly)) continue;
    const result = await hikari.call('plotly.render', { figure: { data: object.plotly.data, layout: object.plotly.layout }, width: Math.max(64, object.width), height: Math.max(64, object.height) });
    if (typeof result?.svg !== 'string') throw new Error('This Hikari build cannot render Plotly plots. Update Hikari and try again.');
    object.svg = validateSvg(result.svg, { plot: true });
  }
}
