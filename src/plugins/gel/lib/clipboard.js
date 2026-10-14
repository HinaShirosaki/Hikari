export async function copyTextToClipboard(text, documentObject = globalThis.document) {
  const clipboard = documentObject?.defaultView?.navigator?.clipboard;
  if (typeof clipboard?.writeText === 'function') {
    try {
      await clipboard.writeText(text);
      return;
    } catch {
      // The host's iframe policy can block the async Clipboard API. A copy
      // command from the user's button click still works inside the plugin.
    }
  }
  if (!documentObject?.body || typeof documentObject.execCommand !== 'function') {
    throw new Error('Clipboard access is unavailable.');
  }
  const previousFocus = documentObject.activeElement;
  const field = documentObject.createElement('textarea');
  field.value = text;
  field.readOnly = true;
  field.style.cssText = 'position:fixed;left:0;top:0;opacity:0;pointer-events:none;';
  documentObject.body.append(field);
  try {
    field.select();
    if (!documentObject.execCommand('copy')) {
      throw new Error('Clipboard access is unavailable.');
    }
  } finally {
    field.remove();
    previousFocus?.focus?.();
  }
}
