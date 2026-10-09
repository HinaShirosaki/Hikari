// Plugins retain their own stacks; this delegate routes Hikari's history
// controls to the editor associated with the focused frame or shared tools.
export function createPluginHistoryDelegate({ documentObject, windowObject, bridge, onChange = () => {} }) {
  let lastFrame = null;
  const activeView = () => documentObject.body?.dataset?.activeView;
  const currentFrame = () => documentObject.getElementById(activeView())?.querySelector('iframe.plugin-frame') || null;
  const validFrame = () => lastFrame?.isConnected && lastFrame.closest('.plugin-view')?.id === activeView() ? lastFrame : null;
  function owner() {
    // Cross-origin frame focus can update activeElement without a host focusin.
    // Read it when history is queried as well as when focus events arrive.
    if (documentObject.activeElement?.tagName === 'IFRAME') lastFrame = documentObject.activeElement;
    return validFrame();
  }
  function refresh() {
    const active = documentObject.activeElement;
    if (active?.tagName === 'IFRAME') lastFrame = active;
    else if (active?.closest?.('#plugin-workspace-tools')?.dataset.viewId === activeView()) lastFrame = currentFrame();
    else if (!active?.closest?.('.topbar-history-controls')) lastFrame = null;
    lastFrame = validFrame();
    onChange();
  }
  documentObject.addEventListener('focusin', refresh);
  windowObject.addEventListener('blur', refresh);
  // A programmatic view change must not leave a hidden editor claiming Undo.
  const Observer = windowObject.MutationObserver;
  if (Observer && documentObject.body) new Observer(refresh).observe(documentObject.body, { attributes: true, attributeFilter: ['data-active-view'] });
  refresh();
  return {
    claim: () => bridge.getFrameHistory(owner()?.contentWindow || null),
    run: command => bridge.sendFrameHistoryCommand(owner()?.contentWindow || null, command),
    refresh
  };
}
