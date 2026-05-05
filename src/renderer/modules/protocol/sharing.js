import { PROTOCOL_SHARE_LINK_PREFIX } from './constants.js';

export function createProtocolSharingController({
  state,
  persist,
  createId,
  trackGrowthEvent,
  ui,
  localState,
  defaultShareStatus,
  navigatorRef,
  TextEncoderClass,
  btoaFn,
  normalizeMaterials,
  getStepText,
  normalizeIsoTimestamp,
  renderList
}) {
  function setShareStatus(message) {
    if (!ui.protocolShareStatus) {
      return;
    }
    const normalized = String(message || '').trim();
    ui.protocolShareStatus.textContent = normalized;
    ui.protocolShareStatus.hidden = !normalized || normalized === defaultShareStatus;
  }

  function setShareLinkOutput(link = '', options = {}) {
    if (!ui.protocolShareLinkPanel || !ui.protocolShareLinkOutput) {
      return;
    }

    const normalizedLink = String(link || '').trim();
    if (!normalizedLink) {
      ui.protocolShareLinkOutput.value = '';
      ui.protocolShareLinkPanel.hidden = true;
      return;
    }

    ui.protocolShareLinkPanel.hidden = false;
    ui.protocolShareLinkOutput.value = normalizedLink;

    if (options.selectText !== false) {
      ui.protocolShareLinkOutput.focus();
      ui.protocolShareLinkOutput.setSelectionRange(0, normalizedLink.length);
    }
  }

  function resolveSenderEmail() {
    const personal = String(state.settings?.personalInfo?.enanaEmail || '').trim();
    if (personal) {
      return personal;
    }

    const firstMemberEmail = state.members
      .map((member) => String(member.enanaEmail || '').trim())
      .find(Boolean);
    return firstMemberEmail || 'system@hikari.local';
  }

  function getShareTargetEmails() {
    return Array.from(new Set(
      state.members
        .map((member) => String(member.enanaEmail || '').trim())
        .filter(Boolean)
    ));
  }

  function renderShareTargets() {
    if (ui.protocolShareStatus && !String(ui.protocolShareStatus.textContent || '').trim()) {
      setShareStatus(defaultShareStatus);
    }
  }

  function serializeProtocol(protocol) {
    const createdAt = normalizeIsoTimestamp(protocol?.createdAt);
    const updatedAt = normalizeIsoTimestamp(protocol?.updatedAt, createdAt);

    return {
      id: protocol.id,
      name: protocol.name,
      createdAt,
      updatedAt,
      purpose: String(protocol.purpose || '').trim(),
      materials: normalizeMaterials(protocol.materials),
      troubleshooting: String(protocol.troubleshooting || '').trim(),
      steps: (protocol.steps || []).map((step) => ({
        id: String(step?.id || createId()),
        text: getStepText(step),
        placeholders: (step?.placeholders || []).map((item) => ({ id: item.id, name: item.name }))
      }))
    };
  }

  function encodeBase64Url(value) {
    const source = String(value ?? '');
    const Encoder = TextEncoderClass || globalThis.TextEncoder;
    const encodeBase64 = typeof btoaFn === 'function' ? btoaFn : globalThis.btoa;
    if (typeof Encoder !== 'function' || typeof encodeBase64 !== 'function') {
      throw new Error('Share link encoding is unavailable in this environment.');
    }
    const bytes = new Encoder().encode(source);
    let binary = '';

    bytes.forEach((byte) => {
      binary += String.fromCharCode(byte);
    });

    return encodeBase64(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }

  function buildProtocolSharePayload(protocol) {
    const serializedProtocol = serializeProtocol(protocol);
    return {
      version: 1,
      type: 'protocol_share_link',
      createdAt: serializedProtocol.updatedAt || serializedProtocol.createdAt || '',
      from: resolveSenderEmail(),
      protocol: serializedProtocol
    };
  }

  function buildProtocolShareToken(protocol) {
    const payload = buildProtocolSharePayload(protocol);
    return encodeBase64Url(JSON.stringify(payload));
  }

  function buildProtocolShareLink(protocol) {
    return `${PROTOCOL_SHARE_LINK_PREFIX}${buildProtocolShareToken(protocol)}`;
  }

  async function copyProtocolShareLink(protocolId) {
    const protocol = state.protocols.find((item) => item.id === protocolId);
    if (!protocol) {
      return;
    }

    const shareLink = buildProtocolShareLink(protocol);
    const clipboard = navigatorRef?.clipboard || globalThis.navigator?.clipboard;

    if (clipboard?.writeText) {
      try {
        await clipboard.writeText(shareLink);
        trackGrowthEvent?.(state, 'protocol_share_link_copied', {
          protocolId: protocol.id,
          protocolName: protocol.name,
          from: resolveSenderEmail()
        });
        persist();
        setShareStatus(`Copied a share link for "${protocol.name}". Paste it anywhere to invite an import.`);
        setShareLinkOutput(shareLink);
        localState.activeShareProtocolId = '';
        localState.activeShareTargetEmail = '';
        renderList?.();
        return;
      } catch {
        // Fall through to manual copy mode when clipboard access is unavailable.
      }
    }

    setShareStatus(`Share link ready for "${protocol.name}". Copy it from the field below.`);
    setShareLinkOutput(shareLink);
    localState.activeShareProtocolId = '';
    localState.activeShareTargetEmail = '';
    renderList?.();
  }

  function shareProtocol(protocolId, toEmail) {
    const protocol = state.protocols.find((item) => item.id === protocolId);
    if (!protocol) {
      return;
    }

    const to = String(toEmail || '').trim();
    if (!to) {
      setShareStatus('Select a teammate before sharing.');
      return;
    }

    const from = resolveSenderEmail();
    if (to.toLowerCase() === from.toLowerCase()) {
      setShareStatus('Cannot share a protocol to your own Hikari email.');
      return;
    }

    const protocolPayload = buildProtocolSharePayload(protocol);
    const shareLink = `${PROTOCOL_SHARE_LINK_PREFIX}${encodeBase64Url(JSON.stringify(protocolPayload))}`;

    state.messages.push({
      id: createId(),
      from,
      to,
      subject: `[Protocol Share] ${protocol.name}`,
      body: `${from} shared protocol "${protocol.name}" with you.`,
      createdAt: new Date().toISOString(),
      readBy: [],
      importedBy: [],
      type: 'protocol_share',
      payload: {
        protocol: protocolPayload.protocol,
        shareLink
      }
    });

    trackGrowthEvent?.(state, 'protocol_share_sent', {
      protocolId: protocol.id,
      protocolName: protocol.name,
      from,
      to
    });

    persist();
    setShareStatus(`Shared "${protocol.name}" with ${to}.`);
    setShareLinkOutput('');
    localState.activeShareProtocolId = '';
    localState.activeShareTargetEmail = '';
    renderList?.();
  }

  return {
    setShareStatus,
    setShareLinkOutput,
    resolveSenderEmail,
    getShareTargetEmails,
    renderShareTargets,
    serializeProtocol,
    buildProtocolSharePayload,
    buildProtocolShareToken,
    buildProtocolShareLink,
    copyProtocolShareLink,
    shareProtocol
  };
}
