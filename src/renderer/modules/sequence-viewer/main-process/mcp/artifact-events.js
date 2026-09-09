'use strict';
function extractSequenceActions(event) {
  const visit = (value, depth = 0) => {
    if (!value || depth > 7) return [];
    if (typeof value === 'string') { try { return visit(JSON.parse(value), depth + 1); } catch { return []; } }
    if (Array.isArray(value)) return value.flatMap(v => visit(v, depth + 1));
    if (typeof value !== 'object') return [];
    if (value.ok === true && /^sequence_/.test(value.mcp_tool || '') && Array.isArray(value.ui_actions)) {
      return value.ui_actions.filter(a => ['open_plasmid', 'open_protein_builder', 'open_primer_design'].includes(a.action)).map(a => ({ action: a.action, entry_id: a.entry_id || '', construct_id: a.construct_id || '', label: a.label, name: value.name || value.summary || '' }));
    }
    return ['result', 'output', 'content', 'structuredContent', 'response', 'text', 'item', 'data', 'tool_result', 'structured_content', 'Ok', 'payload', 'body'].flatMap(k => visit(value[k], depth + 1));
  };
  const found = visit(event);
  return [...new Map(found.map(a => [JSON.stringify(a), a])).values()];
}
module.exports = { extractSequenceActions };
