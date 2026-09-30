'use strict';

const WORKSPACE_FILES_MCP_TOOL = Object.freeze({
  name: 'workspace_files',
  description: 'Read, search, create, edit, move or trash ordinary files in the Hikari workspace or a separately granted location. Call status for access and location IDs. Paths are relative with / separators. Read before write and pass expected_hash. Mutations require a unique request_id; retry uncertain requests with identical arguments. awaiting_approval means no write occurred: direct the user to File changes in Hikari. Managed Hikari records use their dedicated tools. Only Hikari can approve changes and undo them.',
  annotations: { title: 'Workspace files', readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  inputSchema: {
    type: 'object', additionalProperties: false, required: ['action'], properties: {
      action: { type: 'string', enum: ['status', 'list', 'read', 'search', 'create', 'write', 'mkdir', 'move', 'trash'] },
      path: { type: 'string', maxLength: 2000 },
      location_id: { type: 'string', maxLength: 120 },
      destination: { type: 'string', maxLength: 2000 },
      query: { type: 'string', maxLength: 500 },
      content: { type: 'string', maxLength: 12000000 },
      encoding: { type: 'string', enum: ['utf8', 'base64'] },
      expected_hash: { type: 'string', pattern: '^[a-f0-9]{64}$' },
      request_id: { type: 'string', maxLength: 120 }
    }
  }
});

async function callWorkspaceFiles(input = {}, context = {}, deps = {}) {
  if (typeof deps.runTool !== 'function') return { ok: false, status: 'unavailable', error: 'Keep Hikari open to use workspace files.' };
  // No filesystem execution here: the live app owns the root, session and grants.
  return deps.runTool('workspace-files', input, {}, { fileAccessToken: context.fileAccessToken || '' });
}

module.exports = { WORKSPACE_FILES_MCP_TOOL, callWorkspaceFiles };
