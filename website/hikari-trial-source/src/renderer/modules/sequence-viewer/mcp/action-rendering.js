const asArray = value => Array.isArray(value) ? value : [];
export function mergeSequenceActions(previous, incoming) {
  const items = [...asArray(previous), ...asArray(incoming)].filter(a => ['open_plasmid', 'open_protein_builder', 'open_primer_design'].includes(a?.action));
  return [...new Map(items.map(a => [`${a.action}:${a.entry_id || ''}:${a.construct_id || ''}`, a])).values()];
}
export function renderSequenceActions(meta, escape) {
  return mergeSequenceActions([], meta?.sequence_actions).map(action => `<button type="button" class="ghost-btn" data-sequence-mcp-action="${escape(action.action)}" data-sequence-entry-id="${escape(action.entry_id || '')}" data-sequence-construct-id="${escape(action.construct_id || '')}" title="${escape(action.name || action.label || '')}">${escape(action.label || 'Open Sequence Result')}</button>`).join(' ');
}
