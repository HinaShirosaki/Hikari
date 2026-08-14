const GEL_ICON_MARKUP = `
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" data-hikari-icon="gel-analysis">
    <rect x="4.5" y="3.5" width="15" height="17" rx="2" />
    <path d="M7 7h2M11 7h2M15 7h2" />
    <path d="M6.75 11h3M10.5 14h3M14.25 11.75h3M6.75 16.5h3M14.25 17h3" />
  </svg>
`.trim();

export const BUNDLED_PLUGINS = Object.freeze([
  Object.freeze({
    id: 'gel',
    name: 'Gel Analysis',
    version: '2.0.0',
    description: 'Gel image analysis: lane segmentation, band quantification, ladder calibration, and saved gel records.',
    permissions: Object.freeze([
      'storage',
      'files',
      'downloads',
      'layout'
    ]),
    path: '@bundled/gel',
    entryUrl: '',
    embedUrl: '',
    serve: true,
    service: null,
    bundled: true,
    icon: 'gel-analysis',
    iconMarkup: GEL_ICON_MARKUP,
    placement: 'more',
    aliases: Object.freeze(['gel', 'electrophoresis', 'gel analysis']),
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
      aliases: Array.isArray(definition.aliases) ? [...definition.aliases] : [],
      enabled: existing ? existing.enabled !== false : true
    };
  });
  return [
    ...bundled,
    ...installed.filter((entry) => entry?.id && !bundledIds.has(entry.id))
  ];
}
