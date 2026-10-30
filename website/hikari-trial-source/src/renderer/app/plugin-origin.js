// Browser trial adaptation: only shipped plugin assets on this site's origin.
export function pluginOrigin(value) {
  try { const url = new URL(value); return url.origin === location.origin && url.pathname.includes('/runtime/plugins/') ? url.origin : ''; } catch { return ''; }
}
