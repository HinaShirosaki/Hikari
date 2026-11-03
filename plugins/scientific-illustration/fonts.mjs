// Keep the bundled/common suggestions and free-form entry on older hosts.
// A focus retries discovery after a temporary failure or an empty font list.
export function initFontPicker({ hikari, documentObject = document }) {
  const input = documentObject.getElementById('text-font');
  const list = documentObject.getElementById('fonts');
  const fallback = [...list.options].map(option => option.value);
  let loaded = false, pending = null;
  function load() {
    if (loaded) return Promise.resolve(true);
    if (!pending) {
      pending = Promise.resolve().then(() => hikari.call('app.listFonts')).then(result => {
        if (!Array.isArray(result?.families) || !result.families.length) return false;
        const names = new Map();
        for (const value of [...fallback, ...result.families]) {
          const name = typeof value === 'string' ? value.trim() : '';
          if (name && name.length <= 100 && !names.has(name.toLowerCase())) names.set(name.toLowerCase(), name);
        }
        const sorted = [...names.values()].sort((a, b) => a.localeCompare(b));
        list.replaceChildren(...sorted.map(name => {
          const option = documentObject.createElement('option'); option.value = name; return option;
        }));
        loaded = true;
        return true;
      }).catch(() => false).finally(() => { pending = null; });
    }
    return pending;
  }
  input.addEventListener('focus', () => { void load(); });
  void load();
  return { load };
}
