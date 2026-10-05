export function normalizeSourceContext(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'object' || Array.isArray(value)
    || !['protocol', 'paper-selection'].includes(value.kind)) throw new Error('Invalid illustration source context.');
  if (Object.keys(value).some(key => !['kind', 'id', 'title', 'content', 'selectedText', 'pageNumber', 'markdownRelativePath', 'markdownStatus', 'truncated'].includes(key))) throw new Error('Unknown source context field.');
  const result = { kind: value.kind };
  for (const [key, limit] of Object.entries({ id: 200, title: 200, content: 200000, selectedText: 30000, markdownRelativePath: 2400, markdownStatus: 40 })) {
    if (typeof (value[key] ?? '') !== 'string' || (value[key] || '').length > limit) throw new Error(`Invalid source ${key}.`);
    result[key] = value[key] || '';
  }
  if (value.pageNumber !== undefined && (!Number.isInteger(value.pageNumber) || value.pageNumber < 1)) throw new Error('Invalid source page number.');
  if (value.pageNumber !== undefined) result.pageNumber = value.pageNumber;
  result.truncated = value.truncated === true;
  return result;
}

const line = value => typeof value === 'string' ? value : JSON.stringify(value);
const items = value => Array.isArray(value) ? value : value ? [value] : [];
export function illustrationBrief(context) {
  if (context.kind === 'protocol') {
    const protocol = context.protocol;
    if (!protocol?.id) throw new Error('The selected protocol is unavailable.');
    const title = String(protocol.name || 'Protocol').slice(0, 200);
    const content = [`# ${title}`, protocol.purpose || '', '## Materials', ...items(protocol.materials).map(item => `- ${line(item)}`),
      '## Steps', ...items(protocol.steps).map((item, index) => `${index + 1}. ${line(item)}`),
      '## Troubleshooting', ...items(protocol.troubleshooting).map(item => `- ${line(item)}`)].join('\n');
    return { title, message: `Create a scientific illustration of the workflow in “${title}”, showing its main steps and their relationships. Use the attached protocol as the source and preserve its specified conditions; do not invent missing details.`,
      source: normalizeSourceContext({ kind: 'protocol', id: protocol.id, title, content: content.slice(0, 200000), truncated: content.length > 200000 }) };
  }
  if (context.kind !== 'paper-selection' || !context.paper?.id || !context.text?.trim()) throw new Error('The selected paper passage is unavailable.');
  const title = String(context.paper.title || context.paper.fileName || 'Paper').slice(0, 200);
  return { title: `Illustration · ${title}`.slice(0, 200),
    message: `Create a scientific illustration explaining the selected passage from “${title}”. Use the attached paper context to understand the process and its relationships. Focus on the passage and do not invent unsupported details.`,
    source: normalizeSourceContext({ kind: 'paper-selection', id: context.paper.id, title, selectedText: context.text, pageNumber: context.pageNumber,
      content: context.markdown || '', markdownRelativePath: context.markdownRelativePath || '', markdownStatus: context.markdownStatus || 'missing', truncated: context.markdownTruncated }) };
}

export function installSourceActions({ hikari, workspace, beforeCreate = async () => {}, status = () => {} }) {
  let busy = false;
  hikari.on('app.contextAction', async ({ id, actionId }) => {
    if (actionId !== 'generate-illustration') return;
    const respond = result => hikari.call('app.respondContextAction', { id, result });
    if (busy) { await respond({ ok: false, error: 'An illustration is already being generated. Wait for it to finish.' }); return; }
    busy = true;
    try {
      const info = await hikari.call('app.info');
      if (info?.layout?.agentChatRail?.available === false) throw new Error('Sign in to Codex in Settings to generate an illustration.');
      const brief = illustrationBrief(await hikari.call('app.readContextAction', { id }));
      await beforeCreate(); await workspace.ready;
      const created = await workspace.manage('create', '', brief.title, brief.source);
      if (!created.ok) throw new Error(created.error);
      // Ack creation promptly; agent.chat completes only when the drawing does.
      const drawing = hikari.call('agent.chat', { message: brief.message,
        context: { id: created.illustration_id, title: created.title, canvasIllustrationId: created.illustration_id } })
        .catch(error => ({ ok: false, error: error.message }));
      await respond({ ok: true });
      const result = await drawing;
      if (!result.ok) throw new Error(result.error || `Codex could not start: ${result.reason || 'unavailable'}`);
    } catch (error) {
      status(error.message);
      await respond({ ok: false, error: error.message }).catch(() => {});
    } finally { busy = false; }
  });
  return workspace.ready.then(() => hikari.call('app.setContextActions', { actions: [
    { id: 'generate-illustration', label: 'Generate illustration', contexts: ['protocol', 'paper-selection'], requiresAgent: true }
  ] })).catch(error => {
    // Older hosts can still use the standalone canvas; only source actions need
    // the context-action API. Do not make a host upgrade a canvas boot failure.
    if (!/Unknown verb/.test(error.message)) status(error.message);
  });
}
