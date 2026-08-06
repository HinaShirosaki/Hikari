export const BUNDLED_PLUGINS = Object.freeze([
  Object.freeze({
    id: 'gel',
    name: 'Gel Analysis',
    version: '2.0.0',
    description: 'Gel image analysis: lane segmentation, band quantification, ladder calibration, and saved gel records.',
    permissions: Object.freeze([
      'storage',
      'files',
      'downloads'
    ]),
    path: '@bundled/gel',
    entryUrl: '',
    embedUrl: '',
    serve: true,
    service: null,
    bundled: true,
    enabled: true
  })
]);

export function mergeBundledPluginEntries(entries = []) {
  const installed = Array.isArray(entries) ? entries : [];
  const byId = new Map(installed.map((entry) => [entry?.id, entry]));
  const bundledIds = new Set(BUNDLED_PLUGINS.map((entry) => entry.id));
  const bundled = BUNDLED_PLUGINS.map((definition) => {
    const existing = byId.get(definition.id);
    return {
      ...definition,
      permissions: [...definition.permissions],
      enabled: existing ? existing.enabled !== false : true
    };
  });
  return [
    ...bundled,
    ...installed.filter((entry) => entry?.id && !bundledIds.has(entry.id))
  ];
}
