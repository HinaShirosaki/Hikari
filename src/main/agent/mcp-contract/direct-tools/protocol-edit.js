'use strict';

const { randomUUID } = require('node:crypto');
const { asArray, buildReadOnlyToolAnnotations, cleanText } = require('./shared.js');
const {
  MAX_PROTOCOL_STEP_EDITS,
  MAX_PROTOCOL_STEP_TEXT,
  normalizeProtocolStepEdits
} = require('../../../../shared/protocol-step-edits.mjs');

const PROTOCOL_EDIT_MCP_TOOL = Object.freeze({
  name: 'protocol_edit',
  description: 'Propose in-place replacements of existing protocol step text for review and approval in Hikari. For a notebook page’s protocol copy use target_type notebook_page with the saved entry ID and page title. For a saved source protocol use target_type protocol with its protocol ID and name. Read the current target first using active notebook page context, notebook_lookup with detail full, or protocol_lookup. Supply each one-based step number, exact original text, and complete replacement text. Preserve placeholder tokens and edit only the requested steps. Submit one proposal per target and let approval in Hikari apply the replacements.',
  annotations: buildReadOnlyToolAnnotations('Protocol step edit proposal'),
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['target_type', 'target_id', 'target_title', 'step_edits'],
    properties: {
      target_type: { type: 'string', enum: ['notebook_page', 'protocol'] },
      target_id: { type: 'string', minLength: 1, maxLength: 220 },
      target_title: { type: 'string', minLength: 1, maxLength: 320 },
      step_edits: {
        type: 'array',
        minItems: 1,
        maxItems: MAX_PROTOCOL_STEP_EDITS,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['step_number', 'expected_text', 'replacement_text'],
          properties: {
            step_number: { type: 'integer', minimum: 1 },
            expected_text: { type: 'string', minLength: 1, maxLength: MAX_PROTOCOL_STEP_TEXT },
            replacement_text: { type: 'string', minLength: 1, maxLength: MAX_PROTOCOL_STEP_TEXT }
          }
        }
      }
    }
  }
});

function callProtocolEdit(input = {}, context = {}) {
  const { target_type } = input;
  const target_id = cleanText(input.target_id, 220);
  const target_title = cleanText(input.target_title, 320);
  const step_edits = normalizeProtocolStepEdits(input.step_edits);
  const snapshot = context.snapshot || {};
  const storage_path = cleanText(snapshot.settings?.storagePath || context.storagePath, 2400);
  const mcp_tool = PROTOCOL_EDIT_MCP_TOOL.name;
  if (!storage_path || !target_id || !target_title || !step_edits
    || !['notebook_page', 'protocol'].includes(target_type)) {
    return { ok: false, status: 'invalid_arguments', mcp_tool,
      error: 'A saved target in the current workspace and distinct step replacements preserving placeholders are required.' };
  }
  const records = target_type === 'protocol'
    ? snapshot.protocols : snapshot.notebook_lookup_bridge?.entries;
  const record = asArray(records).find(item => item?.id === target_id);
  const result = {
    ok: true,
    status: 'proposal_ready',
    mcp_tool,
    proposal: {
      proposal_id: randomUUID(), storage_path, target_type, target_id, target_title, step_edits,
      expected_updated_at: cleanText(record?.updatedAt, 80)
    },
    save: { mode: 'confirm_before_edit', applied: false, status: 'pending' }
  };
  // The review needs complete before and after text through the MCP text channel.
  if (JSON.stringify(result, null, 2).length > 55000) {
    return { ok: false, status: 'invalid_arguments', mcp_tool,
      error: 'This proposal is too large for review. Submit fewer step replacements at a time.' };
  }
  return result;
}

module.exports = { PROTOCOL_EDIT_MCP_TOOL, callProtocolEdit };
