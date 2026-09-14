export function normalizeAgentHtmlArtifact(source) {
  if (!source || source.type !== 'html' || !/^[a-f0-9]{64}$/.test(source.id)
    || typeof source.title !== 'string' || !source.title.trim() || source.title.length > 220
    || typeof source.html !== 'string' || !source.html.trim() || source.html.includes('\0')
    || source.html.length > 512 * 1024) return null;
  return { type: 'html', id: source.id, title: source.title, html: source.html,
    caption: String(source.caption || '').slice(0, 2000),
    height: Number.isInteger(source.height) && source.height >= 16 && source.height <= 64 ? source.height : 32 };
}
export function mergeAgentHtmlArtifacts(existing = [], incoming = []) {
  const byId = new Map();
  for (const source of [...existing, ...incoming]) {
    const artifact = normalizeAgentHtmlArtifact(source);
    if (artifact) byId.set(artifact.id, artifact);
  }
  return [...byId.values()];
}
export function renderAgentHtml(meta, safeText) {
  const artifacts = mergeAgentHtmlArtifacts([], Array.isArray(meta?.html_artifacts) ? meta.html_artifacts : []);
  if (!artifacts.length) return '';
  return `<div class="agent-output-htmls">${artifacts.map(item => `
    <details class="agent-output-html agent-output-card" data-agent-html-id="${item.id}" open>
      <summary class="agent-output-summary"><span class="agent-output-copy"><strong>${safeText(item.title)}</strong><span>Interactive output</span></span><span class="agent-output-disclosure" aria-hidden="true"></span></summary>
      <div class="agent-output-html-frame" style="height:${item.height}rem" data-agent-html-frame="${item.id}"><p role="status">Loading interactive output…</p></div>
      ${item.caption ? `<p class="agent-output-html-caption">${safeText(item.caption)}</p>` : ''}
    </details>`).join('')}</div>`;
}

export function mountAgentHtml(historyNode, messages, api) {
  const artifacts = new Map();
  for (const message of messages) {
    if (message.role !== 'assistant') continue;
    for (const source of message.meta?.html_artifacts || []) {
      const artifact = normalizeAgentHtmlArtifact(source);
      if (artifact) artifacts.set(artifact.id, artifact);
    }
  }
  historyNode.querySelectorAll('[data-agent-html-frame]').forEach(slot => {
    if (slot.dataset.htmlMounted) return;
    const artifact = artifacts.get(slot.dataset.agentHtmlFrame);
    if (!artifact) return;
    slot.dataset.htmlMounted = 'true';
    if (!api?.agentHtmlPreview) {
      slot.textContent = 'Interactive HTML previews are unavailable in this build. Restart an updated Hikari build.';
      return;
    }
    Promise.resolve().then(() => api.agentHtmlPreview(artifact)).then(result => {
      if (!slot.isConnected) return;
      if (!result?.ok || !/^hikari-html:\/\/preview\/[a-f0-9-]+$/.test(result.url)) throw new Error(result?.error || 'Invalid HTML preview response.');
      const frame = slot.ownerDocument.createElement('iframe');
      frame.setAttribute('sandbox', 'allow-scripts');
      frame.setAttribute('referrerpolicy', 'no-referrer');
      frame.setAttribute('title', artifact.title);
      frame.src = result.url;
      slot.replaceChildren(frame);
    }).catch(error => {
      if (slot.isConnected) slot.textContent = `Interactive output could not load: ${String(error?.message || error)}`;
    });
  });
}
