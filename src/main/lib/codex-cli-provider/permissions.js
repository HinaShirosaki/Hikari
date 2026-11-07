'use strict';

const PRESETS = new Map([
  ['read-only', { sandbox: 'read-only', approvalPolicy: 'on-request', approvalsReviewer: 'user' }],
  ['default', { sandbox: 'workspace-write', approvalPolicy: 'on-request', approvalsReviewer: 'user' }],
  ['approve-for-me', { sandbox: 'workspace-write', approvalPolicy: 'on-request', approvalsReviewer: 'auto_review' }],
  ['full-access', { sandbox: 'danger-full-access', approvalPolicy: 'never', approvalsReviewer: 'user' }]
]);

function getCodexPermissionPreset(id) {
  return PRESETS.get(id);
}

module.exports = { getCodexPermissionPreset };
