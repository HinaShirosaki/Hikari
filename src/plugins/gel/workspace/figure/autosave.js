// One writer per workspace. Edits during an in-flight write remain dirty and
// are saved next; failed writes never advance the clean baseline.
export function createWorkspaceAutosave({ getKey, getContent, save, onSaved, onError, delay = 600 }) {
  let timer = null, pending = null, disposed = false, enabled = false, savedKey = '', lastError = '';
  const dirty = () => enabled && getKey() !== savedKey;
  function schedule() {
    if (!enabled || disposed || !dirty()) return;
    clearTimeout(timer);
    timer = setTimeout(() => { timer = null; void flush(); }, delay);
  }
  async function flush() {
    clearTimeout(timer); timer = null;
    if (pending) { const ok = await pending; return ok && dirty() ? flush() : ok; }
    if (!enabled || disposed) return false;
    if (!dirty()) return true;
    pending = (async () => {
      try {
        const key = getKey(), content = getContent();
        await save(content);
        savedKey = key; lastError = ''; onSaved?.();
        return true;
      } catch (error) {
        const message = String(error?.message || error);
        if (message !== lastError) onError(error);
        lastError = message; return false;
      }
    })();
    const ok = await pending; pending = null;
    if (ok && dirty()) return flush();
    return ok;
  }
  return {
    schedule, flush, dirty,
    enable() { savedKey = getKey(); enabled = true; },
    dispose() { disposed = true; clearTimeout(timer); }
  };
}
