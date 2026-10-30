const EMPTY_ENTRY = Object.freeze({});

export function createModuleRegistry(uiBridge = {}) {
  const entries = new Map();
  const bridgeEntries = uiBridge && typeof uiBridge === 'object' ? uiBridge : {};

  Object.entries(bridgeEntries).forEach(([name, value]) => {
    entries.set(String(name), value);
  });

  function register(name, api) {
    const key = String(name || '').trim();
    if (!key) {
      return EMPTY_ENTRY;
    }
    const nextValue = api == null ? EMPTY_ENTRY : api;
    entries.set(key, nextValue);
    return nextValue;
  }

  function get(name) {
    const key = String(name || '').trim();
    if (!key) {
      return EMPTY_ENTRY;
    }
    return entries.has(key) ? entries.get(key) : EMPTY_ENTRY;
  }

  return {
    register,
    get
  };
}
