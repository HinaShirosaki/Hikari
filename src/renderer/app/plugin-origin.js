// Host capabilities belong only to the private loopback origin assigned by
// the main process. Never accept an opaque origin or a remote server here.
export function pluginOrigin(value) {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'http:' && url.hostname === '127.0.0.1'
      && !url.username && !url.password ? url.origin : '';
  } catch {
    return '';
  }
}
