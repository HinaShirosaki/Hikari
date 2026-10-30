// A user click grants its source to the receiving plugin for that handoff only.
// Plugins cannot choose an arbitrary paper, protocol or filesystem path here.
export function capturePluginActionContext(state, context = {}, api) {
  const root = String(state.settings?.storagePath || '').replace(/[\\/]+$/, '');
  let snapshot;
  if (context.kind === 'protocol') {
    const protocol = (state.protocols || []).find(item => item.id === context.protocolId);
    if (!protocol) throw new Error('The selected protocol no longer exists.');
    snapshot = { kind: 'protocol', protocol: JSON.parse(JSON.stringify(protocol)) };
  } else if (context.kind === 'paper-selection') {
    const paper = (state.papers || []).find(item => item.id === context.paperId);
    if (!paper || typeof context.text !== 'string' || !context.text.trim()) throw new Error('Select text in a saved paper first.');
    if (context.text.length > 30000) throw new Error('Select a passage of at most 30,000 characters.');
    snapshot = { kind: 'paper-selection', paper: Object.fromEntries(['id', 'title', 'fileName', 'doi', 'knowledgeMarkdownRelativePath', 'knowledge_markdown_relative_path'].filter(key => paper[key] !== undefined).map(key => [key, paper[key]])),
      text: context.text, pageNumber: Math.max(1, Math.round(Number(context.pageNumber) || 1)) };
  } else throw new Error('Unsupported source context.');
  return async () => {
    const unchanged = () => String(state.settings?.storagePath || '').replace(/[\\/]+$/, '') === root;
    if (!unchanged()) throw new Error('The storage folder changed. Select the source again.');
    if (snapshot.kind === 'protocol') return snapshot;
    const paper = snapshot.paper;
    const relativePath = String(paper.knowledgeMarkdownRelativePath || paper.knowledge_markdown_relative_path || '').replace(/\\/g, '/');
    const parts = relativePath.split('/');
    const valid = parts.length === 4 && parts[0] === 'KnowledgeBase' && parts[1] === 'papers.md'
      && /\.md$/i.test(parts[3]) && parts.every(part => part && !['.', '..'].includes(part) && !part.includes('\0'));
    const result = { ...snapshot, markdown: '', markdownRelativePath: valid ? relativePath : '', markdownStatus: 'missing', markdownTruncated: false };
    if (!root || !valid || typeof api?.readFileBytes !== 'function') return result;
    try {
      const read = await api.readFileBytes(`${root}/${relativePath}`);
      if (!read?.ok) result.markdownStatus = /ENOENT|ENOTDIR/.test(read?.error || '') ? 'missing' : 'unavailable';
      else {
        const markdown = new TextDecoder().decode(read.bytes);
        result.markdown = markdown.slice(0, 200000);
        result.markdownTruncated = markdown.length > result.markdown.length;
        result.markdownStatus = result.markdownTruncated ? 'truncated' : 'ready';
      }
    } catch { result.markdownStatus = 'unavailable'; }
    if (!unchanged()) throw new Error('The storage folder changed. Select the source again.');
    return result;
  };
}
