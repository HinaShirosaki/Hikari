import {
  INSIGHT_FILE_NAME,
  INSIGHT_SCHEMA_NAME,
  INSIGHT_SCHEMA_VERSION
} from './constants.js';
import { normalizeInsights } from './insight-model.js';
import { cleanText, sanitizeFolderName } from './text-utils.js';

export function resolveNotebookStorageFolder(storagePath, record) {
  const configuredStoragePath = cleanText(storagePath, 2400);
  if (!configuredStoragePath) {
    return '';
  }
  const explicitStorageFolder = cleanText(record?.storageFolder, 2400);
  if (explicitStorageFolder) {
    return explicitStorageFolder;
  }
  const projectFolder = sanitizeFolderName(record?.projectName || 'Untitled_Project', 'Untitled_Project');
  const pageFolder = `${sanitizeFolderName(
    record?.protocolName || record?.id || 'Notebook_Page',
    'Notebook_Page'
  )}__${sanitizeFolderName(record?.id, 'page')}`;
  return `${configuredStoragePath}/Project/${projectFolder}/Notebook/${pageFolder}`;
}

export function resolveProtocolStorageFolder(storagePath, record) {
  const configuredStoragePath = cleanText(storagePath, 2400);
  if (!configuredStoragePath) {
    return '';
  }
  const folderName = `${sanitizeFolderName(record?.name || 'Protocol', 'Protocol')}__${sanitizeFolderName(record?.id, 'protocol')}`;
  return `${configuredStoragePath}/Protocol/${folderName}`;
}

export function resolveInsightStorageFolder(context) {
  const record = context?.record && typeof context.record === 'object' ? context.record : {};
  const storagePath = cleanText(context?.storagePath, 2400);
  if (!storagePath) {
    return '';
  }
  if (context?.kind === 'notebook') {
    return resolveNotebookStorageFolder(storagePath, record);
  }
  if (context?.kind === 'protocol') {
    return resolveProtocolStorageFolder(storagePath, record);
  }
  return '';
}

export async function persistInsightSidecar({ api, context, insights }) {
  if (!api?.writeJsonFile) {
    return;
  }
  const storagePath = cleanText(context?.storagePath, 2400);
  const targetFolder = resolveInsightStorageFolder(context);
  if (!storagePath || !targetFolder) {
    return;
  }
  const record = context?.record && typeof context.record === 'object' ? context.record : {};
  try {
    await api.writeJsonFile({
      storagePath,
      targetFolder,
      fileName: INSIGHT_FILE_NAME,
      data: {
        schema_name: INSIGHT_SCHEMA_NAME,
        schema_version: INSIGHT_SCHEMA_VERSION,
        updated_at: new Date().toISOString(),
        owner: {
          kind: cleanText(context?.kind, 40),
          id: cleanText(record?.id, 120),
          name: cleanText(record?.name || record?.protocolName, 220)
        },
        insights: normalizeInsights(insights)
      }
    });
  } catch {
    // Sidecar sync is best-effort because state persistence already preserves answers.
  }
}
