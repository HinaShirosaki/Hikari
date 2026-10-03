import { isAgentAvailable } from '../lib/agent-availability.js';

export function createPluginChatContextHandler({ documentObject = globalThis.document, getModuleRuntime } = {}) {
  return (plugin, context) => {
    if (!context || typeof context.id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(context.id)) {
      throw new Error('Chat context requires an item id of 1–100 letters, numbers, underscores or hyphens.');
    }
    if (context.title !== undefined && (typeof context.title !== 'string' || context.title.length > 200)) throw new Error('Chat context title must be at most 200 characters.');
    if (context.canvasIllustrationId !== undefined && (typeof context.canvasIllustrationId !== 'string'
      || !/^[a-zA-Z0-9_-]{1,100}$/.test(context.canvasIllustrationId))) throw new Error('Invalid canvas illustration id.');
    const viewId = `plugin-${plugin.id}-view`;
    const view = documentObject?.getElementById?.(viewId);
    if (!view || view.dataset.pluginId !== plugin.id) throw new Error('The plugin workspace is unavailable.');
    view.dataset.pluginChatContextId = context.id;
    view.dataset.pluginChatContextTitle = context.title || '';
    view.dataset.pluginCanvasIllustrationId = context.canvasIllustrationId || '';
    if (documentObject.body?.dataset.activeView === viewId) getModuleRuntime?.()?.modules?.agentChatRail?.render?.();
    return { ok: true, contextId: context.id };
  };
}

export function createPluginPromptHandler({ state, getNavigation, getModuleRuntime, setChatContext } = {}) {
  return async (plugin, message, context) => {
    if (!isAgentAvailable()) return { ok: false, reason: 'unavailable', error: 'Sign in to Codex in Settings to use the agent.' };
    if (plugin?.permissions?.includes('agent:canvas') && (state?.settings?.agent?.disabledMcpToolNames || []).includes('plugin_canvas')) return {
      ok: false, error: 'Enable the Plugin canvases MCP tool in Settings before drawing with Codex.'
    };
    if (context) {
      if (!setChatContext) throw new Error('Item-scoped plugin chat is unavailable in this build.');
      setChatContext(plugin, context);
    }
    const navigation = getNavigation?.();
    navigation?.showView(`plugin-${plugin.id}-view`);
    navigation?.openAgentChatRail?.();
    getModuleRuntime?.()?.modules?.agentChatRail?.render?.();
    getModuleRuntime?.()?.modules?.agentChatRail?.focusComposer?.();
    return getModuleRuntime?.()?.modules?.agentChatRail?.submitExternalMessage?.(message) || { ok: false, reason: 'unavailable' };
  };
}
