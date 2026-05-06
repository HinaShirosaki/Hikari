// Collaboration and in-app messaging controller.
//
// Responsibilities:
// - render Hikari email selectors for sending and viewing messages
// - normalize and import shared protocols from inbox messages, links, or JSON
// - decode portable protocol-share payloads
// - track share/import growth events and keep collaboration UI in sync
export function initCollaborationManagement({
  state,
  persist,
  createId,
  safeText,
  onProtocolsImported,
  trackGrowthEvent
}) {
  // Constants and DOM references for the messaging form, inbox, and protocol-link import UI.
  const PROTOCOL_SHARE_LINK_PREFIX = 'hikari://protocol-share/';
  const LEGACY_PROTOCOL_SHARE_LINK_PREFIX = 'enana://protocol-share/';
  const PROTOCOL_SHARE_TOKEN_PREFIX = 'HIKARI_PROTOCOL_SHARE:';
  const LEGACY_PROTOCOL_SHARE_TOKEN_PREFIX = 'ENANA_PROTOCOL_SHARE:';
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
  const defaultProtocolLinkStatus = 'Paste a shared protocol link or protocol JSON, then click Import Link.';

  // Wire up collaboration UI interactions once DOM references are available.
  messageForm.addEventListener('submit', onSendMessage);
  inboxEmailSelect.addEventListener('change', renderInbox);
  importProtocolLinkBtn?.addEventListener('click', importProtocolFromLink);

  // Split multi-line text while normalizing Windows and Unix newline styles.
  function splitTextLines(rawText) {
    return String(rawText || '').replace(/\r\n?/g, '\n').split('\n');
  }

  // Remove bullet or ordered-list prefixes from one line of pasted text.
  function stripBulletPrefix(rawLine) {
    return String(rawLine || '')
      .replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '')
      .trim();
  }

  // Normalize materials into a clean string array from either arrays or textarea-style text.
  function normalizeMaterials(rawMaterials) {
    if (Array.isArray(rawMaterials)) {
      return rawMaterials
        .map((item) => String(item || '').trim())
        .filter(Boolean);
    }

    return splitTextLines(rawMaterials)
      .map((line) => stripBulletPrefix(line))
      .filter(Boolean);
  }

  // Normalize troubleshooting content into the app's plain multi-line string format.
  function normalizeTroubleshooting(rawTroubleshooting) {
    if (Array.isArray(rawTroubleshooting)) {
      return rawTroubleshooting
        .filter((item) => item && typeof item === 'object')
        .map((item) => {
          const problem = String(item.problem || '').trim();
          const possibleCause = String(item.possible_cause || item.possibleCause || '').trim();
          const solution = String(item.solution || '').trim();
          const chunks = [];
          if (problem) {
            chunks.push(`Problem: ${problem}`);
          }
          if (possibleCause) {
            chunks.push(`Possible cause: ${possibleCause}`);
          }
          if (solution) {
            chunks.push(`Solution: ${solution}`);
          }
          return chunks.join('; ');
        })
        .filter(Boolean)
        .join('\n');
    }

    return String(rawTroubleshooting || '').trim();
  }

  // Convert bracket placeholders like [time] into internal placeholder tokens plus metadata.
  function extractPlaceholdersFromText(rawText) {
    const placeholders = [];
    const cleanedText = String(rawText || '')
      .replace(/\[([^[\]]*)\]/g, (_match, rawName) => {
        const name = String(rawName || '').trim() || 'value';
        const id = createId();
        placeholders.push({ id, name });
        return `{{ph:${id}}}`;
      })
      .replace(/\s+/g, ' ')
      .trim();
    return { cleanedText, placeholders };
  }

  // Normalize imported step data into the protocol step shape used by the app.
  function normalizeSteps(rawSteps) {
    if (!Array.isArray(rawSteps)) {
      return [];
    }

    const withOrder = rawSteps
      .map((step, index) => ({ step, index }))
      .filter(({ step }) => step != null)
      .sort((a, b) => {
        const stepNumberA = Number(a.step?.step_number);
        const stepNumberB = Number(b.step?.step_number);
        const hasNumberA = Number.isFinite(stepNumberA);
        const hasNumberB = Number.isFinite(stepNumberB);
        if (hasNumberA && hasNumberB && stepNumberA !== stepNumberB) {
          return stepNumberA - stepNumberB;
        }
        if (hasNumberA !== hasNumberB) {
          return hasNumberA ? -1 : 1;
        }
        return a.index - b.index;
      });

    return withOrder
      .map(({ step }) => {
        if (typeof step === 'string') {
          const rawText = String(step || '').trim();
          if (!rawText) {
            return null;
          }
          const parsed = extractPlaceholdersFromText(rawText);
          return {
            id: createId(),
            text: parsed.cleanedText || rawText,
            placeholders: parsed.placeholders
          };
        }

        if (typeof step !== 'object') {
          return null;
        }

        const rawText = String(step.action || step.text || step.instruction || '').trim();
        if (!rawText) {
          return null;
        }
        const parsed = extractPlaceholdersFromText(rawText);
        return {
          id: String(step.id || createId()),
          text: parsed.cleanedText || rawText,
          placeholders: Array.isArray(step.placeholders)
            ? step.placeholders
              .filter((item) => item && typeof item === 'object')
              .map((item) => ({ id: String(item.id || createId()), name: String(item.name || '').trim() || 'value' }))
              .filter((item) => item.name)
            : parsed.placeholders
        };
      })
      .filter(Boolean);
  }

  // Collect the unique Hikari email addresses defined in the Members section.
  function getEnanaEmails() {
    const emails = state.members
      .map((member) => member.enanaEmail)
      .filter((email) => email && email.trim());
    return Array.from(new Set(emails));
  }

  // Populate sender, recipient, and inbox selectors and keep the inbox view up to date.
  function renderEmailSelectors() {
    const emails = getEnanaEmails();
    const options = emails.map((email) => `<option value="${safeText(email)}">${safeText(email)}</option>`).join('');
    const fallback = '<option value="">No Hikari emails in Members</option>';

    fromSelect.innerHTML = options || fallback;
    toSelect.innerHTML = options || fallback;
    inboxEmailSelect.innerHTML = `<option value="">Select inbox email</option>${options}`;

    renderInbox();
    if (protocolLinkStatus && !String(protocolLinkStatus.textContent || '').trim()) {
      protocolLinkStatus.textContent = defaultProtocolLinkStatus;
    }
  }

  // Update the helper text shown below the protocol-link import controls.
  function setProtocolLinkStatus(message) {
    if (!protocolLinkStatus) {
      return;
    }
    protocolLinkStatus.textContent = message;
  }

  // Validate and normalize one imported protocol object before adding it to app state.
  function sanitizeIncomingProtocol(raw) {
    if (!raw || typeof raw !== 'object') {
      return null;
    }

    const name = String(raw.name || raw.title || '').trim();
    if (!name) {
      return null;
    }

    const purpose = String(raw.purpose || '').trim();
    const troubleshooting = normalizeTroubleshooting(raw.troubleshooting);
    const nowIso = new Date().toISOString();

    const parsedCreatedAt = Date.parse(String(raw.createdAt || '').trim());
    const createdAt = Number.isFinite(parsedCreatedAt) ? new Date(parsedCreatedAt).toISOString() : nowIso;
    const parsedUpdatedAt = Date.parse(String(raw.updatedAt || '').trim());
    const updatedAt = Number.isFinite(parsedUpdatedAt) ? new Date(parsedUpdatedAt).toISOString() : createdAt;

    const materials = normalizeMaterials(raw.materials);
    const steps = normalizeSteps(raw.steps || raw.procedure);

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

  // Normalize either a single protocol payload or an array of protocols.
  function sanitizeIncomingProtocols(raw) {
    if (Array.isArray(raw)) {
      return raw.map((item) => sanitizeIncomingProtocol(item)).filter(Boolean);
    }
    const single = sanitizeIncomingProtocol(raw);
    return single ? [single] : [];
  }

  // Avoid protocol name collisions when importing shared copies.
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

  // Add an imported protocol, cloning identifiers or names only when conflicts exist.
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

  // Decode a URL-safe base64 token into its original UTF-8 JSON text.
  function decodeBase64Url(value) {
    const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
    const padLength = normalized.length % 4;
    const padded = normalized + '='.repeat((4 - padLength) % 4);
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }

  // Extract the encoded share token from a deep link, prefixed share string, or raw token input.
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
    const legacyLinkIndex = value.indexOf(LEGACY_PROTOCOL_SHARE_LINK_PREFIX);
    if (legacyLinkIndex >= 0) {
      const after = value.slice(legacyLinkIndex + LEGACY_PROTOCOL_SHARE_LINK_PREFIX.length);
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
    const legacyPrefixedIndex = value.indexOf(LEGACY_PROTOCOL_SHARE_TOKEN_PREFIX);
    if (legacyPrefixedIndex >= 0) {
      const after = value.slice(legacyPrefixedIndex + LEGACY_PROTOCOL_SHARE_TOKEN_PREFIX.length);
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

  // Decode and validate a protocol-share payload from pasted link text.
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
      const hasProtocolPayload = Boolean(parsed.protocol) || Array.isArray(parsed.protocols);
      if (parsed.type !== 'protocol_share_link' || !hasProtocolPayload) {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }

  // Parse protocol JSON from raw text, fenced code blocks, or wrapped object/array payloads.
  function parseProtocolsFromJson(raw) {
    const value = String(raw || '').trim();
    if (!value) {
      return [];
    }

    const candidates = [value];
    const fenceMatch = value.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenceMatch?.[1]) {
      candidates.push(String(fenceMatch[1]).trim());
    }

    const firstBrace = value.indexOf('{');
    const lastBrace = value.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      candidates.push(value.slice(firstBrace, lastBrace + 1));
    }

    const firstBracket = value.indexOf('[');
    const lastBracket = value.lastIndexOf(']');
    if (firstBracket >= 0 && lastBracket > firstBracket) {
      candidates.push(value.slice(firstBracket, lastBracket + 1));
    }

    let parsed = null;
    for (const candidate of candidates) {
      try {
        const next = JSON.parse(candidate);
        if (Array.isArray(next) || (next && typeof next === 'object')) {
          parsed = next;
          break;
        }
      } catch {
        // Try next candidate.
      }
    }

    if (!parsed) {
      return [];
    }
    if (Array.isArray(parsed)) {
      return sanitizeIncomingProtocols(parsed);
    }
    if (Array.isArray(parsed.protocols)) {
      return sanitizeIncomingProtocols(parsed.protocols);
    }
    if (parsed.protocol && typeof parsed.protocol === 'object') {
      return sanitizeIncomingProtocols(parsed.protocol);
    }
    return sanitizeIncomingProtocols(parsed);
  }

  // Import a protocol attached to an inbox message into local protocol state for the selected inbox.
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

  // Import one or more protocols from a pasted share link or raw JSON payload.
  function importProtocolFromLink() {
    const rawInput = String(protocolLinkInput?.value || '').trim();
    if (!rawInput) {
      setProtocolLinkStatus('Paste a protocol link or protocol JSON first.');
      return;
    }

    const payload = parseProtocolSharePayload(rawInput);
    const incomingProtocols = payload
      ? sanitizeIncomingProtocols(payload.protocol || payload.protocols)
      : parseProtocolsFromJson(rawInput);

    if (!incomingProtocols.length) {
      setProtocolLinkStatus('Invalid protocol link or protocol JSON payload.');
      return;
    }

    const importedProtocols = incomingProtocols.map((incoming) => addImportedProtocol(incoming));
    importedProtocols.forEach((importedProtocol, index) => {
      const source = incomingProtocols[index];
      trackGrowthEvent?.(state, 'protocol_share_link_imported', {
        from: String(payload?.from || '').trim() || 'unknown',
        sourceProtocolId: source.id,
        importedProtocolId: importedProtocol.id
      });
    });

    persist();
    onProtocolsImported?.();
    renderInbox();
    if (protocolLinkInput) {
      protocolLinkInput.value = '';
    }
    if (importedProtocols.length === 1) {
      setProtocolLinkStatus(`Imported "${importedProtocols[0].name}".`);
      return;
    }
    setProtocolLinkStatus(`Imported ${importedProtocols.length} protocols.`);
  }

  // Render inbox actions and helper text for messages that contain shared protocols.
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

  // Validate the message form and append a new in-app message to collaboration state.
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

  // Render the selected inbox, newest message first, including any protocol-import actions.
  function renderInbox() {
    const inboxEmail = inboxEmailSelect.value;
    if (!inboxEmail) {
      inboxList.innerHTML = '<p class="small-note">Select a Hikari email to check inbox.</p>';
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

  // Public API exposed to the rest of the app.
  return { renderEmailSelectors, renderInbox };
}
