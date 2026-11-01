'use strict';

const { normalizeAssayContextTable } = require('../../../shared/assay-agent-context.mjs');

async function stageAssayContextTables(contexts, { agentToolRuntime, snapshot, agent = {} }) {
  const staged = [];
  for (const context of contexts) {
    const table = normalizeAssayContextTable(context.assayTable);
    if (!table?.rows.length) {
      staged.push(context);
      continue;
    }
    if (agent.disabledMcpToolNames?.includes('assay_table')) {
      staged.push({ ...context, text: `Complete active plate data has ${table.row_count} rows, but assay_table is disabled. The TSV below is only a preview; do not calculate or plot it as the full plate.\n${context.text}` });
      continue;
    }
    const result = await agentToolRuntime.runAgentTool('assay-table', {
      action: 'create', name: `${context.assayName || 'Active plate'} — current rows`.slice(0, 160),
      columns: table.columns, rows: table.rows
    }, snapshot, { agentMcp: true, allowWriteTools: true });
    const payload = result?.result || result;
    if (result?.ok === false || payload?.ok === false || !payload?.table?.id
      || payload.table.row_count !== table.row_count) {
      throw new Error('Could not stage the complete active plate table. Refresh the plate context and retry.');
    }
    staged.push({ ...context, text: [
      `Complete current plate data is already staged in assay_table: table_id=${JSON.stringify(payload.table.id)}, row_count=${table.row_count}.`,
      `Columns: ${table.columns.join(', ')}. This snapshot includes current UI values. Use this table ID directly for derive/python; do not recreate it from the TSV preview or substitute a previous turn's table.`,
      'read returns paginated rows: follow table.next_offset with offset until null. Python input_table.json includes every stored row. Build graphs from complete calculated output.',
      context.text
    ].join('\n') });
  }
  return staged;
}

module.exports = { stageAssayContextTables };
