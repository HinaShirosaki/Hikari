'use strict';

async function answerCodexApproval(method, params, items, approve) {
  let message;
  let detail;
  let permissions;
  switch (method) {
    case 'item/commandExecution/requestApproval': {
      const target = params.networkApprovalContext;
      message = 'Allow this Codex command?';
      const command = params.command || items.get(params.itemId)?.command;
      detail = params.kind !== 'writeStdin' && (command || target?.host)
        ? [command, params.cwd, target?.host && `${target.protocol} ${target.host}`, params.reason].filter(Boolean).join('\n\n')
        : '';
      break;
    }
    case 'item/fileChange/requestApproval': {
      message = 'Allow this Codex file change?';
      const changes = items.get(params.itemId)?.changes;
      detail = Array.isArray(changes) && changes.length && changes.every(change => change.path && typeof change.diff === 'string')
        ? [params.reason, params.grantRoot, ...changes.map(change => [
          change.kind?.type, change.path, change.kind?.move_path, change.diff
        ].filter(Boolean).join('\n'))].filter(Boolean).join('\n\n') : '';
      break;
    }
    case 'item/permissions/requestApproval': {
      message = 'Allow this Codex permission request?';
      const { network, fileSystem } = params.permissions || {};
      permissions = { ...(network ? { network } : {}), ...(fileSystem ? { fileSystem } : {}) };
      if (network || fileSystem) detail = [params.cwd, params.reason, JSON.stringify(permissions, null, 2)].filter(Boolean).join('\n\n');
      break;
    }
    default:
      return null;
  }
  // An incomplete prompt cannot authorize an action. Never truncate a command or diff.
  const allowed = Boolean(detail && detail.length <= 8000 && await approve?.({ message, detail }));
  return method === 'item/permissions/requestApproval'
    ? { scope: 'turn', permissions: allowed ? permissions : {} }
    : { decision: allowed ? 'accept' : 'decline' };
}

module.exports = { answerCodexApproval };
