export function initCollaborationManagement({
  state,
  persist,
  createId,
  safeText,
  onProtocolsImported,
  trackGrowthEvent
}) {
  const PROTOCOL_SHARE_LINK_PREFIX = 'enana://protocol-share/';
  const PROTOCOL_SHARE_TOKEN_PREFIX = 'ENANA_PROTOCOL_SHARE:';
  const messageForm = document.getElementById('message-form');
  const fromSelect = document.getElementById('message-from');
  const toSelect = document.getElementById('message-to');
  const subjectInput = document.getElementById('message-subject');
  const bodyInput = document.getElementById('message-body');
  const inboxEmailSelect = document.getElementById('inbox-email');
  const inboxList = document.getElementById('inbox-list');
  const protocolLinkInput = document.getElementById('protocol-link-input');
  const importProtocolLinkBtn = document.getElementById('import-protocol-link-btn');
  const protocolLinkStatus = document.getElementById('protocol-link-status');
  const defaultProtocolLinkStatus = 'Paste a shared protocol link, then click Import Link.';

  messageForm.addEventListener('submit', onSendMessage);
  inboxEmailSelect.addEventListener('change', renderInbox);
  importProtocolLinkBtn?.addEventListener('click', importProtocolFromLink);

  function getEnanaEmails() {
    const emails = state.members
      .map((member) => member.enanaEmail)
      .filter((email) => email && email.trim());
    return Array.from(new Set(emails));
  }

  function renderEmailSelectors() {
    const emails = getEnanaEmails();
    const options = emails.map((email) => `<option value="${safeText(email)}">${safeText(email)}</option>`).join('');
    const fallback = '<option value="">No Enana emails in Members</option>';

    fromSelect.innerHTML = options || fallback;
    toSelect.innerHTML = options || fallback;
    inboxEmailSelect.innerHTML = `<option value="">Select inbox email</option>${options}`;

    renderInbox();
    if (protocolLinkStatus && !String(protocolLinkStatus.textContent || '').trim()) {
      protocolLinkStatus.textContent = defaultProtocolLinkStatus;
    }
  }

  function setProtocolLinkStatus(message) {
    if (!protocolLinkStatus) {
      return;
    }
    protocolLinkStatus.textContent = message;
  }

  function sanitizeIncomingProtocol(raw) {
    if (!raw || typeof raw !== 'object') {
      return null;
    }

    const name = String(raw.name || '').trim();
    if (!name) {
      return null;
    }

    const purpose = String(raw.purpose || '').trim();
    const troubleshooting = String(raw.troubleshooting || '').trim();
    const nowIso = new Date().toISOString();

    const parsedCreatedAt = Date.parse(String(raw.createdAt || '').trim());
    const createdAt = Number.isFinite(parsedCreatedAt) ? new Date(parsedCreatedAt).toISOString() : nowIso;
    const parsedUpdatedAt = Date.parse(String(raw.updatedAt || '').trim());
    const updatedAt = Number.isFinite(parsedUpdatedAt) ? new Date(parsedUpdatedAt).toISOString() : createdAt;

    const materials = Array.isArray(raw.materials)
      ? raw.materials
        .map((item) => String(item || '').trim())
        .filter(Boolean)
      : String(raw.materials || '')
        .split(/\r?\n/)
        .map((line) => String(line || '').replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim())
        .filter(Boolean);

    const steps = Array.isArray(raw.steps)
      ? raw.steps
        .filter((step) => step && typeof step === 'object')
        .map((step) => ({
          id: String(step.id || createId()),
          text: String(step.text || '').trim(),
          placeholders: Array.isArray(step.placeholders)
            ? step.placeholders
              .filter((item) => item && typeof item === 'object')
              .map((item) => ({ id: String(item.id || createId()), name: String(item.name || '').trim() }))
              .filter((item) => item.name)
            : []
        }))
      : [];

    return {
      id: String(raw.id || createId()),
      name,
      createdAt,
      updatedAt,
      purpose,
      materials,
      steps,
      troubleshooting
    };
  }

  function buildUniqueProtocolCopyName(baseName) {
    const taken = new Set(
      state.protocols
        .map((item) => String(item.name || '').trim().toLowerCase())
        .filter(Boolean)
    );

    let candidate = baseName;
    let suffix = 2;
    while (taken.has(candidate.toLowerCase())) {
      candidate = `${baseName} ${suffix}`;
      suffix += 1;
    }
    return candidate;
  }

  function addImportedProtocol(incoming) {
    const hasIdConflict = state.protocols.some((item) => item.id === incoming.id);
    const hasNameConflict = state.protocols.some((item) => String(item.name || '').trim().toLowerCase() === incoming.name.toLowerCase());
    let importedProtocol = incoming;
    if (hasIdConflict || hasNameConflict) {
      importedProtocol = {
        ...incoming,
        id: createId(),
        name: buildUniqueProtocolCopyName(`${incoming.name} (Shared Copy)`)
      };
    }
    state.protocols.push(importedProtocol);
    return importedProtocol;
  }

  function decodeBase64Url(value) {
    const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
    const padLength = normalized.length % 4;
    const padded = normalized + '='.repeat((4 - padLength) % 4);
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }

  function extractProtocolShareToken(raw) {
    const value = String(raw || '').trim();
    if (!value) {
      return '';
    }

    const linkIndex = value.indexOf(PROTOCOL_SHARE_LINK_PREFIX);
    if (linkIndex >= 0) {
      const after = value.slice(linkIndex + PROTOCOL_SHARE_LINK_PREFIX.length);
      const tokenFromLink = after.split(/[\s?#&]/)[0];
      if (tokenFromLink) {
        return tokenFromLink;
      }
    }

    const prefixedIndex = value.indexOf(PROTOCOL_SHARE_TOKEN_PREFIX);
    if (prefixedIndex >= 0) {
      const after = value.slice(prefixedIndex + PROTOCOL_SHARE_TOKEN_PREFIX.length);
      const tokenFromPrefix = after.split(/\s/)[0];
      if (tokenFromPrefix) {
        return tokenFromPrefix;
      }
    }

    if (/^[A-Za-z0-9_-]{16,}$/.test(value)) {
      return value;
    }

    return '';
  }

  function parseProtocolSharePayload(raw) {
    const token = extractProtocolShareToken(raw);
    if (!token) {
      return null;
    }

    try {
      const decoded = decodeBase64Url(token);
      const parsed = JSON.parse(decoded);
      if (!parsed || typeof parsed !== 'object') {
        return null;
      }
      if (parsed.type !== 'protocol_share_link' || !parsed.protocol) {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }

  function importSharedProtocol(messageId) {
    const inboxEmail = String(inboxEmailSelect.value || '').trim();
    if (!inboxEmail) {
      return;
    }

    const message = state.messages.find((item) => item.id === messageId && item.to === inboxEmail);
    if (!message || message.type !== 'protocol_share') {
      return;
    }

    if (!Array.isArray(message.importedBy)) {
      message.importedBy = [];
    }
    if (message.importedBy.includes(inboxEmail)) {
      return;
    }

    const incoming = sanitizeIncomingProtocol(message.payload?.protocol);
    if (!incoming) {
      return;
    }

    const importedProtocol = addImportedProtocol(incoming);

    message.importedBy.push(inboxEmail);
    if (!Array.isArray(message.readBy)) {
      message.readBy = [];
    }
    if (!message.readBy.includes(inboxEmail)) {
      message.readBy.push(inboxEmail);
    }

    trackGrowthEvent?.(state, 'protocol_share_imported', {
      messageId: message.id,
      from: message.from,
      to: inboxEmail,
      sourceProtocolId: incoming.id,
      importedProtocolId: importedProtocol.id
    });

    persist();
    onProtocolsImported?.();
    renderInbox();
  }

  function importProtocolFromLink() {
    const rawInput = String(protocolLinkInput?.value || '').trim();
    if (!rawInput) {
      setProtocolLinkStatus('Paste a protocol link first.');
      return;
    }

    const payload = parseProtocolSharePayload(rawInput);
    if (!payload) {
      setProtocolLinkStatus('Invalid protocol link. Please paste a valid Enana share link.');
      return;
    }

    const incoming = sanitizeIncomingProtocol(payload.protocol);
    if (!incoming) {
      setProtocolLinkStatus('This link does not include a valid protocol payload.');
      return;
    }

    const importedProtocol = addImportedProtocol(incoming);

    trackGrowthEvent?.(state, 'protocol_share_link_imported', {
      from: String(payload.from || '').trim() || 'unknown',
      sourceProtocolId: incoming.id,
      importedProtocolId: importedProtocol.id
    });

    persist();
    onProtocolsImported?.();
    renderInbox();
    if (protocolLinkInput) {
      protocolLinkInput.value = '';
    }
    setProtocolLinkStatus(`Imported "${importedProtocol.name}" from share link.`);
  }

  function renderProtocolShareActions(message, inboxEmail) {
    if (message.type !== 'protocol_share') {
      return '';
    }

    const alreadyImported = Array.isArray(message.importedBy) && message.importedBy.includes(inboxEmail);
    const helper = alreadyImported
      ? '<p class="small-note">Protocol already imported for this inbox.</p>'
      : '<p class="small-note">Shared protocol attached.</p>';
    const disabledAttr = alreadyImported ? ' disabled' : '';
    const buttonLabel = alreadyImported ? 'Imported' : 'Import Protocol';

    return `
      ${helper}
      <div class="form-actions">
        <button type="button" class="ghost-btn" data-import-protocol="${message.id}"${disabledAttr}>${buttonLabel}</button>
      </div>
    `;
  }

  function onSendMessage(event) {
    event.preventDefault();

    const from = fromSelect.value;
    const to = toSelect.value;
    const subject = subjectInput.value.trim();
    const body = bodyInput.value.trim();

    if (!from || !to || !subject || !body) {
      return;
    }

    state.messages.push({
      id: createId(),
      from,
      to,
      subject,
      body,
      createdAt: new Date().toISOString(),
      readBy: []
    });

    persist();
    messageForm.reset();
    renderEmailSelectors();
    fromSelect.value = from;
    toSelect.value = to;
  }

  function renderInbox() {
    const inboxEmail = inboxEmailSelect.value;
    if (!inboxEmail) {
      inboxList.innerHTML = '<p class="small-note">Select an Enana email to check inbox.</p>';
      return;
    }

    const messages = state.messages
      .filter((message) => message.to === inboxEmail)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    if (!messages.length) {
      inboxList.innerHTML = '<p class="small-note">Inbox is empty.</p>';
      return;
    }

    inboxList.innerHTML = messages.map((message) => `
      <article class="card">
        <p><strong>From:</strong> ${safeText(message.from)}</p>
        <p><strong>Subject:</strong> ${safeText(message.subject)}</p>
        <p>${safeText(message.body)}</p>
        <p class="small-note">${new Date(message.createdAt).toLocaleString()}</p>
        ${renderProtocolShareActions(message, inboxEmail)}
      </article>
    `).join('');

    inboxList.querySelectorAll('[data-import-protocol]').forEach((button) => {
      button.addEventListener('click', () => importSharedProtocol(button.dataset.importProtocol));
    });
  }

  return { renderEmailSelectors, renderInbox };
}
