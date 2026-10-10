// Declarative plugin buttons share the host's existing tools/chat strip. The
// frame retains the editor and receives only actions for its own active view.
import { PROTOCOL_MARKER } from './plugin-bridge/helpers.js';
import { workspaceToolIconPaths as paths } from './plugin-workspace-tool-icons.js';
const fields = new Set(['id', 'label', 'icon', 'kind', 'group', 'disabled', 'pressed', 'expanded']);
export function normalizeWorkspaceTools(params) {
  if (!params || Object.keys(params).some(key => !['tools', 'focusId'].includes(key))
    || !Array.isArray(params.tools) || params.tools.length > 24) throw new Error('Workspace tools require at most 24 declarative items.');
  const ids = new Set();
  const tools = params.tools.map(tool => {
    if (!tool || typeof tool !== 'object' || Array.isArray(tool) || Object.keys(tool).some(key => !fields.has(key))) throw new Error('Invalid workspace tool fields.');
    if (typeof tool.id !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(tool.id) || ids.has(tool.id)) throw new Error('Workspace tool IDs must be unique lowercase identifiers.');
    ids.add(tool.id);
    if (typeof tool.label !== 'string' || !tool.label.trim() || tool.label.length > 100) throw new Error('Workspace tools need a label of at most 100 characters.');
    const kind = tool.kind ?? 'button';
    if (!['button', 'output'].includes(kind) || (kind === 'button' && !Object.hasOwn(paths, tool.icon))) throw new Error('Use a supported workspace tool icon or an output item.');
    if (tool.group !== undefined && (typeof tool.group !== 'string' || tool.group.length > 40)) throw new Error('Invalid workspace tool group.');
    for (const key of ['disabled', 'pressed', 'expanded']) if (tool[key] !== undefined && typeof tool[key] !== 'boolean') throw new Error(`Workspace tool ${key} must be boolean.`);
    return { ...tool, label: tool.label.trim(), kind };
  });
  if (params.focusId !== undefined && (typeof params.focusId !== 'string' || !tools.some(tool => tool.id === params.focusId && tool.kind === 'button' && !tool.disabled))) throw new Error('Focus must target an enabled workspace tool.');
  return { tools, focusId: params.focusId };
}

export function createPluginWorkspaceTools({ windowObject, getRegistration }) {
  const doc = windowObject?.document, slot = doc?.getElementById?.('plugin-workspace-tools');
  const configurations = new Map();
  let renderedOwner, renderedTools = '';
  const activeView = () => doc?.body?.dataset?.activeView;
  const ownerIsActive = (frame, entry) => getRegistration(frame) === entry.registration
    && entry.registration.plugin.enabled !== false && entry.registration.plugin.permissions?.includes('layout')
    && activeView() === `plugin-${entry.registration.plugin.id}-view`;
  function notify() {
    const EventCtor = doc?.defaultView?.CustomEvent;
    if (EventCtor) doc.dispatchEvent(new EventCtor('hikari:workspace-tools-changed'));
  }
  function render() {
    if (!slot) return;
    const owner = [...configurations].find(([frame, entry]) => entry.tools.length && ownerIsActive(frame, entry));
    doc.body.classList.toggle('has-plugin-workspace-tools', Boolean(owner));
    slot.hidden = !owner;
    slot.dataset.viewId = owner ? activeView() : '';
    const signature = owner ? JSON.stringify(owner[1].tools) : '';
    if (renderedOwner === owner?.[0] && renderedTools === signature) return;
    const focusedId = slot.contains(doc.activeElement) ? doc.activeElement.dataset.workspaceToolId : '';
    renderedOwner = owner?.[0]; renderedTools = signature; slot.replaceChildren();
    if (owner) {
      const [frame, entry] = owner;
      slot.setAttribute('aria-label', `${entry.registration.plugin.name || entry.registration.plugin.id} tools`);
      let group;
      for (const tool of entry.tools) {
        const node = doc.createElement(tool.kind === 'output' ? 'output' : 'button');
        node.dataset.workspaceToolId = tool.id;
        node.className = 'plugin-workspace-tool';
        node.classList.toggle('is-group-start', group !== undefined && group !== tool.group);
        group = tool.group;
        node.title = tool.label; node.setAttribute('aria-label', tool.label);
        if (tool.kind === 'output') node.textContent = tool.label;
        else {
          node.type = 'button'; node.disabled = tool.disabled === true;
          for (const [key, attr] of [['pressed', 'aria-pressed'], ['expanded', 'aria-expanded']]) if (tool[key] !== undefined) node.setAttribute(attr, String(tool[key]));
          const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
          svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');
          for (const d of paths[tool.icon]) { const path = doc.createElementNS(svg.namespaceURI, 'path'); path.setAttribute('d', d); svg.append(path); }
          node.append(svg);
          node.addEventListener('click', event => {
            const current = configurations.get(frame);
            if (!current || !ownerIsActive(frame, current) || !current.tools.some(item => item.id === tool.id && item.kind === 'button' && !item.disabled)) return;
            const view = doc.getElementById(activeView()), top = view?.getBoundingClientRect?.().top || 0;
            frame.postMessage({ hikari: PROTOCOL_MARKER, event: 'app.workspaceTool', payload: { id: tool.id, y: event.clientY - top } }, entry.registration.origin);
          });
        }
        slot.append(node);
      }
      if (focusedId) [...slot.children].find(node => node.dataset.workspaceToolId === focusedId && !node.disabled)?.focus();
    }
    notify();
  }
  slot?.addEventListener('keydown', event => {
    if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    const buttons = [...slot.querySelectorAll('button:not(:disabled)')], index = buttons.indexOf(event.target);
    if (index < 0) return;
    event.preventDefault();
    buttons[event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowUp' ? -1 : 1) + buttons.length) % buttons.length]?.focus();
  });
  const Observer = windowObject?.MutationObserver;
  if (slot && Observer) new Observer(render).observe(doc.body, { attributes: true, attributeFilter: ['data-active-view'] });
  return {
    set(params, frame) {
      if (!slot) throw new Error('Workspace tools are unavailable in this host.');
      const normalized = normalizeWorkspaceTools(params), registration = getRegistration(frame);
      configurations.set(frame, { registration, tools: normalized.tools }); render();
      if (normalized.focusId && ownerIsActive(frame, configurations.get(frame))) [...slot.children].find(node => node.dataset.workspaceToolId === normalized.focusId)?.focus();
      return { mounted: true };
    },
    clear(frame) { configurations.delete(frame); render(); },
    setChatExpanded(params, frame) {
      if (typeof params.expanded !== 'boolean' || Object.keys(params).some(key => key !== 'expanded')) throw new Error('Chat expansion requires a boolean expanded.');
      const plugin = getRegistration(frame)?.plugin;
      if (activeView() !== `plugin-${plugin?.id}-view`) throw new Error('Only the active plugin can change its chat rail.');
      const EventCtor = doc?.defaultView?.CustomEvent;
      if (!EventCtor) throw new Error('Chat rail is unavailable.');
      doc.dispatchEvent(new EventCtor(params.expanded ? 'hikari:open-agent-chat-rail' : 'hikari:close-agent-chat-rail'));
      return { expanded: doc.body.classList.contains('has-agent-chat-rail-expanded') };
    }
  };
}
