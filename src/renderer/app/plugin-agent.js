export function createPluginPromptHandler({ state, getNavigation, getModuleRuntime } = {}) {
  return async (plugin, message) => {
    if (plugin?.permissions?.includes('agent:canvas') && (state?.settings?.agent?.disabledMcpToolNames || []).includes('plugin_canvas')) return {
      ok: false, error: 'Enable the Plugin canvases MCP tool in Settings before drawing with Codex.'
    };
    const navigation = getNavigation?.();
    navigation?.showView(`plugin-${plugin.id}-view`);
    navigation?.openAgentChatRail?.();
    return getModuleRuntime?.()?.modules?.agentChatRail?.submitExternalMessage?.(message) || { ok: false, reason: 'unavailable' };
  };
}
