import { initWorkflowManagement as initWorkflowManagementImpl } from './workflow/index.js';

export function initWorkflowManagement(options) {
  return initWorkflowManagementImpl(options);
}
