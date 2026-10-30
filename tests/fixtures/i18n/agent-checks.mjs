// Real Agent view, shared rail and chat chrome with disposable state; no agent requests.
export async function checkLocalizedAgent({ core, i18n, check }) {
  const { renderDraftCards } = await import('../../../src/renderer/modules/agent-chat/rendering-drafts.js');
  const { renderFileChangePreview } = await import('../../../src/renderer/modules/agent-chat/review-overlay/file-changes.js');
  const { renderAgentHtml } = await import('../../../src/renderer/modules/agent-chat/html-artifacts.js');
  const module = core.moduleRuntime.modules.agentChat;
  const state = core.state;
  const byId = id => document.getElementById(id);
  const root = byId('agent-view');
  const settle = (ms = 40) => new Promise(resolve => setTimeout(resolve, ms));
  const toast = () => document.querySelector('[data-hikari-transient-toast]');
  const safeText = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const params = node => JSON.parse(node.getAttribute('data-i18n-params') || '{}');
  const assertBindings = host => {
    for (const node of host.querySelectorAll('[data-i18n]')) {
      if (node.children.length || (node.matches('option') && !node.hasAttribute('value'))) continue;
      check(i18n.has(node.dataset.i18n) && node.textContent === i18n.t(node.dataset.i18n, params(node)), 'Agent binding: ' + node.dataset.i18n);
    }
    for (const attribute of ['title', 'aria-label', 'placeholder']) {
      const binding = 'data-i18n-' + attribute;
      for (const node of host.querySelectorAll('[' + binding + ']')) {
        const key = node.getAttribute('data-i18n-' + attribute);
        check(node.getAttribute(attribute) === i18n.t(key, JSON.parse(node.getAttribute(binding + '-params') || node.getAttribute('data-i18n-params') || '{}')), 'Agent attribute binding: ' + key);
      }
    }
  };

  const availability = document.body.dataset.agentAvailability;
  document.body.dataset.agentAvailability = 'connected';
  i18n.setLocale('en');
  state.agentChat.projectId = '';
  state.agentChat.messages = [];
  core.navigationShell.showView('agent-view'); module.render(); await settle();
  const history = byId('agent-chat-history');
  const emptyTitle = history.querySelector('.agent-empty-state h3');
  check(emptyTitle?.textContent === 'Start a new lab thread', 'English empty chat keeps its wording');
  i18n.setLocale('es');
  check(emptyTitle.isConnected && emptyTitle.textContent === 'Empiece un nuevo hilo de laboratorio', 'Empty chat translates live');

  // Message chrome translates around literal chat text and attachment names.
  const now = new Date().toISOString();
  state.agentChat.messages = [
    { id: 'i18n-user', role: 'user', text: 'Question <&>', createdAt: now, attachments: [{ name: 'data <&>.csv', kind: 'file' }] },
    { id: 'i18n-assistant', role: 'assistant', text: 'Answer <&>', createdAt: now, meta: {} }
  ];
  const before = JSON.stringify(state.agentChat);
  i18n.setLocale('en'); module.render(); await settle();
  const copy = history.querySelector('[data-agent-copy-message="i18n-assistant"]');
  check(copy?.getAttribute('aria-label') === 'Copy response' && history.textContent.includes('Answer <&>') && history.textContent.includes('data <&>.csv'),
    'English message chrome keeps its wording around literal chat text');
  const input = byId('agent-message-input');
  input.value = 'Unsent draft <&>'; input.focus(); input.setSelectionRange(1, 6);
  i18n.setLocale('es'); await settle(10);
  check(document.activeElement === input && input.value === 'Unsent draft <&>' && input.selectionStart === 1 && input.selectionEnd === 6
    && JSON.stringify(state.agentChat) === before, 'Language switching preserves the composer draft, focus, selection and chat state');
  check(copy.isConnected && copy.getAttribute('aria-label') === 'Copiar respuesta' && history.querySelector('.agent-attachment-pill-meta span')?.textContent === 'Archivo',
    'Copy and attachment chrome translate live');
  check(input.placeholder === i18n.t(input.getAttribute('data-i18n-placeholder')) && input.placeholder.startsWith('Pregunte a Hikari'),
    'Composer placeholder translates');
  check(byId('agent-project-select').options[0].textContent === 'Todos los proyectos' && byId('agent-project-select').options[0].value === '',
    'Project scope keeps its empty value');

  // Session rail: built-in General folder, disclosure, new-chat action and duplicate-name guard.
  const list = byId('agent-session-list');
  const general = list.querySelector('[data-agent-folder-id="general"]');
  const disclosure = general?.closest('.folder-tree-template__node')?.querySelector('.folder-tree-template__disclosure');
  const newChat = list.querySelector('[data-agent-new-chat-folder="general"]');
  check(general?.textContent.includes('General') && /^(Expandir|Contraer) General$/.test(disclosure?.getAttribute('aria-label') || '')
    && newChat?.getAttribute('aria-label') === 'Nuevo chat en General' && general.getAttribute('aria-label') === 'Chats generales',
  'Session folder chrome translates');
  general.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 40, clientY: 200 }));
  check(byId('agent-context-new-folder').textContent === 'Nueva carpeta', 'Session folder menu translates');
  byId('agent-context-new-folder').click(); await settle(20);
  const rename = list.querySelector('[data-folder-tree-rename-input]');
  check(rename?.getAttribute('aria-label') === 'Cambiar el nombre de la carpeta de chats', 'Chat folder rename has a translated label');
  rename.value = 'General'; rename.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await settle(20);
  check(toast()?.textContent === 'Ya existe una carpeta de chats con ese nombre.', 'Duplicate chat folder notice translates: ' + toast()?.textContent);
  toast().hidden = true;
  assertBindings(root);

  // Draft cards, file approvals and HTML outputs wrap literal agent content.
  const host = document.createElement('div');
  host.innerHTML = renderDraftCards({}, 'i18n-draft', {
    safeText, notebookDraftAdapter: null,
    protocolReviewAdapter: { collectReviewProtocols: () => [{ name: '', materials: [], steps: [] }] }
  }) + renderFileChangePreview({ id: 'file-1', change: { id: 'change-1', action: 'move', path: 'dir/a <&>.txt', destination: 'dir/b.txt',
    location_id: 'workspace', preview: { count: 3 } } }, safeText)
    + renderAgentHtml({ html_artifacts: [{ type: 'html', id: 'a'.repeat(64), title: 'Plot <&>', html: '<p>x</p>' }] }, safeText);
  document.body.append(host);
  check(host.textContent.includes('Borrador de protocolo') && host.textContent.includes('Protocolo · Requiere revisión')
    && host.textContent.includes('No se indican materiales.') && host.textContent.includes('Añadir a protocolos')
    && host.textContent.includes('Mover') && host.textContent.includes('A dir/b.txt') && host.textContent.includes('3 elementos')
    && host.textContent.includes('Permitir para la carpeta') && host.textContent.includes('Resultado interactivo')
    && host.textContent.includes('Plot <&>') && host.textContent.includes('dir/a <&>.txt') && !host.querySelector('img'),
  'Draft, file-change and HTML cards translate chrome around literal content');
  i18n.setLocale('en');
  check(host.textContent.includes('Protocol draft') && host.textContent.includes('Protocol · Review required') && host.textContent.includes('Allow once'),
    'Draft and file cards return to their original English');
  host.remove(); i18n.setLocale('es');

  // Shared rail: toggle, quick prompts (labels translate, prompts stay English).
  core.navigationShell.showView('home-view'); await settle();
  const toggle = byId('agent-chat-rail-toggle-btn');
  const prompt = byId('agent-rail-quick-prompts').querySelector('[data-agent-suggest-prompt]:not([hidden])');
  check(['Abrir el panel de chat del agente', 'Plegar el panel de chat del agente'].includes(toggle.getAttribute('aria-label')),
    'Rail toggle translates: ' + toggle.getAttribute('aria-label'));
  check(prompt && prompt.textContent === i18n.t(prompt.dataset.i18n) && /^(Summarize|Suggest|Flag|Generate|Research|Draft|Analyze|Create) /.test(prompt.dataset.agentSuggestPrompt),
    'Quick prompt labels translate while the prompt sent to the agent stays English');
  check(JSON.stringify(state.agentChat.messages) === JSON.stringify(JSON.parse(before).messages), 'Chat chrome translation never changes chat messages');
  document.body.dataset.agentAvailability = availability || 'offline';
  window.qaI18nAgent = { ready: true };
}
