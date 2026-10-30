const ICON_PATHS = Object.freeze({
  attach: '<path d="m20.5 10.5-8.8 8.8a5 5 0 0 1-7.1-7.1l9.2-9.2a3.5 3.5 0 0 1 5 5L9.6 17a2 2 0 0 1-2.8-2.8l8.4-8.4" />',
  chat: '<path d="M6.5 4.5h11a3 3 0 0 1 3 3v5a3 3 0 0 1-3 3h-7l-3.5 3.25V15.5h-.5a3 3 0 0 1-3-3v-5a3 3 0 0 1 3-3Z" /><path d="M8.5 10h.01M12 10h.01M15.5 10h.01" />',
  close: '<path d="m6 6 12 12M18 6 6 18" />',
  context: '<path d="M6 3h8l4 4v14H6z" /><path d="M14 3v5h5M9 12h6M9 16h6" />',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" />',
  'chevron-right': '<path d="m8 5 7 7-7 7" />',
  draft: '<path d="M7 3.5h7l3 3v14H7z" /><path d="M14 3.5v4h4" />',
  'new-chat': '<path d="M12 3H6a3 3 0 0 0-3 3v12a3 3 0 0 0 3 3h12a3 3 0 0 0 3-3v-6" /><path d="m16 3 5 5M9 15l4-1 9-9a2.8 2.8 0 0 0-4-4l-9 9-1 5Z" />',
  'rail-collapse': '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5" /><path d="M14.5 4.5v15m-7.25-10 2.5 2.5-2.5 2.5" />',
  screenshot: '<path d="M7 3.75H4.75a1 1 0 0 0-1 1V7M17 3.75h2.25a1 1 0 0 1 1 1V7M20.25 17v2.25a1 1 0 0 1-1 1H17M7 20.25H4.75a1 1 0 0 1-1-1V17" /><rect x="8" y="8" width="8" height="8" rx="1.25" />',
  send: '<path d="M12 19V5" /><path d="m6.5 10.5 5.5-5.5 5.5 5.5" />'
});

function normalizeClassName(className = '') {
  return Array.from(new Set([
    'agent-chat-icon',
    ...String(className).split(/\s+/).filter((name) => /^[A-Za-z][\w-]*$/.test(name))
  ])).join(' ');
}

export function renderAgentChatIcon(name, { className = '' } = {}) {
  const iconName = String(name || '').trim();
  const paths = ICON_PATHS[iconName];
  if (!paths) return '';
  return `<svg class="${normalizeClassName(className)}" viewBox="0 0 24 24" role="presentation" aria-hidden="true" focusable="false" data-agent-chat-icon="${iconName}">${paths}</svg>`;
}

export function hydrateAgentChatIcons(rootDocument = globalThis.document) {
  if (typeof rootDocument?.querySelectorAll !== 'function' || typeof rootDocument?.createElementNS !== 'function') {
    return;
  }
  for (const placeholder of rootDocument.querySelectorAll('[data-agent-chat-icon]')) {
    if (placeholder.namespaceURI === 'http://www.w3.org/2000/svg') continue;
    const iconName = placeholder.getAttribute('data-agent-chat-icon');
    const paths = ICON_PATHS[iconName];
    if (!paths) continue;
    const icon = rootDocument.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.setAttribute('class', normalizeClassName(placeholder.getAttribute('class')));
    icon.setAttribute('viewBox', '0 0 24 24');
    icon.setAttribute('role', 'presentation');
    icon.setAttribute('aria-hidden', 'true');
    icon.setAttribute('focusable', 'false');
    icon.setAttribute('data-agent-chat-icon', iconName);
    icon.innerHTML = paths;
    placeholder.replaceWith(icon);
  }
}
