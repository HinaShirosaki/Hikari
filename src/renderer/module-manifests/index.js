import { biologyNotebookManifest } from './biology-notebook.js';
import { protocolManifest } from './protocol.js';
import { projectManagementManifest } from './project-management.js';
import { agentChatManifest } from './agent-chat.js';
import { agentChatRailManifest } from './agent-chat-rail.js';
import { workflowManagementManifest } from './workflow.js';
import { papersManifest } from './papers.js';
import { labCommonInventoryManifest } from './lab-common-inventory.js';
import { personalInventoryManifest } from './personal-inventory.js';
import { sampleRegistryManifest } from './sample-registry.js';
import { assayManifest } from './assay.js';
import { gelManifest } from './gel.js';
import { sequenceViewerManifest } from './sequence-viewer.js';
import { toolBoxManifest } from './tool-box.js';
import { settingsManifest } from './settings.js';
import { homeDashboardManifest } from './home-dashboard.js';

export const foundationModuleManifests = [
  biologyNotebookManifest,
  protocolManifest,
  projectManagementManifest
];

export const collaborationModuleManifests = [
  agentChatManifest,
  agentChatRailManifest,
  workflowManagementManifest,
  papersManifest
];

export const inventoryModuleManifests = [
  labCommonInventoryManifest,
  personalInventoryManifest,
  sampleRegistryManifest
];

export const analysisModuleManifests = [
  assayManifest,
  gelManifest
];

export const sequenceModuleManifests = [
  sequenceViewerManifest
];

export const utilityModuleManifests = [
  toolBoxManifest,
  settingsManifest,
  homeDashboardManifest
];

export const rendererModuleManifests = [
  ...foundationModuleManifests,
  ...collaborationModuleManifests,
  ...inventoryModuleManifests,
  ...analysisModuleManifests,
  ...sequenceModuleManifests,
  ...utilityModuleManifests
];
