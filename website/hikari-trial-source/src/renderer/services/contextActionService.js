export function createContextActionService(registry) {
  return {
    list: kind => registry.get('pluginBridge')?.contextActions?.list(kind) || [],
    invoke: (key, context) => registry.get('pluginBridge')?.contextActions?.invoke(key, context)
      || Promise.resolve({ ok: false, error: 'Plugin context actions are unavailable.' })
  };
}
