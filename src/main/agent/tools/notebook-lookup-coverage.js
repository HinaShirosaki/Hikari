'use strict';

const { asArray } = require('../../lib/normalize.js');

function buildNotebookLookupCoverage(context = {}, snapshot = {}, itemCount = 0) {
  const permissionWarnings = asArray(context.warnings)
    .filter((warning) => /permission denied|\bEPERM\b|\bEACCES\b/i.test(String(warning || '')));
  const otherWarnings = asArray(context.warnings).filter((warning) => !permissionWarnings.includes(warning));
  const accessStatus = permissionWarnings.length
    ? (itemCount ? 'degraded' : 'permission_denied')
    : (otherWarnings.length ? 'degraded' : 'ready');
  const appliedSources = asArray(context.migration?.applied);
  return {
    source: appliedSources.includes('notebook_markdown') ? 'markdown' : 'fallback_json',
    sources: [
      ...(asArray(snapshot?.notebookEntries).length ? ['request_snapshot'] : []),
      ...(Number(context.liveNotebookBridge?.entryCount) > 0 ? ['live_notebook_bridge'] : []),
      ...(context.loadedDataFile ? ['data_file'] : []),
      ...(appliedSources.includes('notebook_sidecar') ? ['notebook_sidecar'] : []),
      ...(appliedSources.includes('project_root_storage') ? ['project_storage'] : []),
      ...(appliedSources.includes('workflow_root_storage') ? ['workflow_storage'] : []),
      ...(appliedSources.includes('notebook_markdown') ? ['notebook_markdown'] : [])
    ],
    candidateCount: asArray(context.hydratedSnapshot?.notebookEntries).length,
    access: {
      status: accessStatus,
      complete: accessStatus === 'ready',
      retryable: permissionWarnings.length > 0,
      warning_codes: [
        ...(permissionWarnings.length ? ['storage_permission_denied'] : []),
        ...(otherWarnings.length ? ['storage_read_warning'] : [])
      ],
      warnings: [
        ...(permissionWarnings.length ? ['Hikari could not read part of the configured notebook storage.'] : []),
        ...(otherWarnings.length ? ['One or more notebook storage sources could not be read.'] : [])
      ],
      user_action: permissionWarnings.length
        ? 'Grant Hikari access to the configured storage folder, or choose that folder again in Hikari Settings, then retry the lookup.'
        : ''
    }
  };
}

module.exports = { buildNotebookLookupCoverage };
