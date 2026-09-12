// Forwards renderer failures to the main-process error log. Fire-and-forget:
// reporting must never throw into the code that just failed.
export function reportRendererError(source, payload = {}, windowObject = window) {
  try {
    windowObject.hikariApi?.reportError?.({
      source: String(source || ''),
      message: String(payload.message || ''),
      stack: String(payload.stack || ''),
      file: String(payload.file || ''),
      line: Number.isFinite(payload.line) ? payload.line : undefined
    });
  } catch {
    // The bridge is missing (tests, plugin sandboxes) — nothing to do.
  }
}

export function installRendererErrorReporting(windowObject = window) {
  windowObject.addEventListener('error', (event) => {
    reportRendererError('renderer:error', {
      message: event.message || event.error?.message,
      stack: event.error?.stack,
      file: event.filename,
      line: event.lineno
    }, windowObject);
  });
  windowObject.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    reportRendererError('renderer:unhandledrejection', {
      message: reason?.message || String(reason ?? ''),
      stack: reason?.stack
    }, windowObject);
  });
}
