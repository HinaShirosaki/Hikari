'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { asArray, ensureObject } = require('../../lib/normalize.js');
const {
  releaseOfficialMcpSkillsForWorkspace
} = require('../../agent/codex-agent/official-mcp-skills.js');
const {
  ensureCodexCliRuntimeHome
} = require('../../lib/codex-cli-provider/runtime-home.js');
const {
  sanitizeProjectMemoryFolderName
} = require('../../storage/storage-memory.js');

function defaultCleanText(value, maxLength = 2000) {
  const text = String(value || '').trim();
  if (!text) {
    return '';
  }
  return maxLength > 0 ? text.slice(0, maxLength) : text;
}

function parseJsonObject(value = '') {
  try {
    return ensureObject(JSON.parse(String(value || '')));
  } catch {
    return {};
  }
}

function isFilesystemRoot(candidatePath = '') {
  const value = String(candidatePath || '').trim();
  if (!value) {
    return false;
  }
  try {
    const resolved = path.resolve(value);
    return resolved === path.parse(resolved).root;
  } catch {
    return false;
  }
}

async function readJsonObject(filePath = '') {
  const target = String(filePath || '').trim();
  if (!target) {
    return {};
  }
  try {
    const parsed = JSON.parse(await fs.readFile(target, 'utf8'));
    return ensureObject(parsed);
  } catch {
    return {};
  }
}

function addWorkspacePath(workspacePaths, candidatePath = '') {
  const cleanPath = String(candidatePath || '').trim();
  if (!cleanPath || isFilesystemRoot(cleanPath)) {
    return;
  }
  workspacePaths.add(path.resolve(cleanPath));
}

function resolveStoragePath({ snapshot = {}, bundlePaths = {}, dataFilePath = '', getBundlePaths = null, cleanText = defaultCleanText } = {}) {
  const snapshotSettings = ensureObject(snapshot.settings);
  const configuredStoragePath = cleanText(
    snapshotSettings.storagePath
      || snapshotSettings.storage_path
      || snapshot.storagePath
      || snapshot.storage_path,
    2400
  );
  if (configuredStoragePath) {
    return path.resolve(configuredStoragePath);
  }
  const bundleStoragePath = cleanText(bundlePaths.storageRootPath, 2400);
  if (bundleStoragePath) {
    return path.resolve(bundleStoragePath);
  }
  if (getBundlePaths) {
    try {
      const resolvedPaths = getBundlePaths({ dataFilePath });
      const storageRootPath = cleanText(resolvedPaths?.storageRootPath, 2400);
      if (storageRootPath) {
        return path.resolve(storageRootPath);
      }
    } catch {
      // Fall through to the data-file directory fallback.
    }
  }
  return dataFilePath ? path.dirname(path.resolve(dataFilePath)) : '';
}

function collectCodexWorkspacePaths({ cwd = '', snapshot = {}, storagePath = '', dataFilePath = '', cleanText = defaultCleanText } = {}) {
  const workspacePaths = new Set();
  addWorkspacePath(workspacePaths, cwd);
  addWorkspacePath(workspacePaths, storagePath);
  if (dataFilePath) {
    addWorkspacePath(workspacePaths, path.dirname(path.resolve(dataFilePath)));
  }
  if (storagePath) {
    asArray(snapshot.projects).forEach((project) => {
      const normalizedProject = ensureObject(project);
      const projectName = cleanText(
        normalizedProject.name
          || normalizedProject.project_name
          || normalizedProject.projectName
          || normalizedProject.title,
        320
      );
      if (!projectName) {
        return;
      }
      addWorkspacePath(
        workspacePaths,
        path.join(storagePath, 'Project', sanitizeProjectMemoryFolderName(projectName, 'Untitled_Project'))
      );
    });
  }
  return [...workspacePaths];
}

async function releaseSkillsForWorkspaces(
  workspacePaths = [],
  releaseOfficialSkills = releaseOfficialMcpSkillsForWorkspace,
  context = {}
) {
  const releases = [];
  for (const workspacePath of workspacePaths) {
    try {
      const skillReleases = await releaseOfficialSkills(workspacePath, context);
      releases.push({
        workspacePath,
        ok: true,
        releases: asArray(skillReleases)
      });
    } catch (error) {
      releases.push({
        workspacePath,
        ok: false,
        error: String(error?.message || error || 'Unable to release official MCP skills.')
      });
    }
  }
  return releases;
}

function createCodexWorkspaceInitializer(deps = {}) {
  const cleanText = typeof deps.cleanText === 'function' ? deps.cleanText : defaultCleanText;
  const getCodexCliWorkingDirectory = typeof deps.getCodexCliWorkingDirectory === 'function'
    ? deps.getCodexCliWorkingDirectory
    : (() => process.cwd());
  const getBundlePaths = typeof deps.getBundlePaths === 'function' ? deps.getBundlePaths : null;
  const mcpHost = deps.mcpHost && typeof deps.mcpHost === 'object' ? deps.mcpHost : null;
  const ensureRuntimeHome = typeof deps.ensureCodexCliRuntimeHome === 'function'
    ? deps.ensureCodexCliRuntimeHome
    : ensureCodexCliRuntimeHome;
  const releaseOfficialSkills = typeof deps.releaseOfficialMcpSkillsForWorkspace === 'function'
    ? deps.releaseOfficialMcpSkillsForWorkspace
    : releaseOfficialMcpSkillsForWorkspace;
  let activeInitialization = null;
  let lastResult = null;

  async function loadSnapshot(input = {}, dataFilePath = '') {
    const inputSnapshot = ensureObject(input.snapshot);
    if (Object.keys(inputSnapshot).length) {
      return inputSnapshot;
    }
    return readJsonObject(dataFilePath);
  }

  function resolveRequestContext(input = {}) {
    const envOverrides = ensureObject(input.envOverrides);
    return parseJsonObject(
      envOverrides.HIKARI_AGENT_MCP_REQUEST_CONTEXT
        || envOverrides.HIKARI_CODEX_REQUEST_CONTEXT
    );
  }

  function resolveBundlePaths(snapshot = {}, dataFilePath = '', fallbackDataFilePath = '') {
    if (!getBundlePaths) {
      return {};
    }
    const snapshotSettings = ensureObject(snapshot.settings);
    try {
      return ensureObject(getBundlePaths({
        dataFilePath,
        fallbackDataFilePath,
        storagePath: snapshotSettings.storagePath || snapshotSettings.storage_path || snapshot.storagePath || snapshot.storage_path
      }));
    } catch {
      return {};
    }
  }

  async function runInitialization(input = {}) {
    const cwd = cleanText(input.cwd || getCodexCliWorkingDirectory(), 2400);
    const requestContext = resolveRequestContext(input);
    const contextSnapshot = ensureObject(requestContext.snapshot);
    const inputSnapshot = ensureObject(input.snapshot);
    const snapshotSeed = Object.keys(inputSnapshot).length ? inputSnapshot : contextSnapshot;
    const dataFilePath = cleanText(
      input.dataFilePath
        || input.data_file_path
        || requestContext.dataFilePath
        || requestContext.data_file_path
        || snapshotSeed.data_file_path
        || snapshotSeed.dataFilePath,
      2400
    );
    const fallbackDataFilePath = cleanText(
      input.fallbackDataFilePath
        || input.fallback_data_file_path
        || requestContext.fallbackDataFilePath
        || requestContext.fallback_data_file_path
        || snapshotSeed.fallback_data_file_path
        || snapshotSeed.fallbackDataFilePath
        || dataFilePath,
      2400
    );
    const host = mcpHost && typeof mcpHost.ensureStarted === 'function'
      ? await mcpHost.ensureStarted()
      : {};
    const hostUrl = cleanText(host?.url || mcpHost?.getHostUrl?.(), 2400);
    const token = cleanText(host?.token || mcpHost?.getToken?.(), 4000);
    const snapshot = await loadSnapshot({
      ...input,
      snapshot: snapshotSeed
    }, dataFilePath);
    const bundlePaths = resolveBundlePaths(snapshot, dataFilePath, fallbackDataFilePath);
    const storagePath = resolveStoragePath({
      snapshot,
      bundlePaths,
      dataFilePath,
      getBundlePaths,
      cleanText
    });
    const envOverrides = {
      ...(input.envOverrides && typeof input.envOverrides === 'object' ? input.envOverrides : {}),
      ...(hostUrl ? {
        HIKARI_AGENT_MCP_HOST: hostUrl,
        HIKARI_CODEX_MCP_HOST: hostUrl
      } : {}),
      ...(token ? {
        HIKARI_AGENT_MCP_TOKEN: token,
        HIKARI_CODEX_MCP_TOKEN: token
      } : {}),
      ...(dataFilePath ? { HIKARI_AGENT_DATA_FILE: dataFilePath } : {}),
      ...(storagePath ? { HIKARI_AGENT_STORAGE_PATH: storagePath } : {})
    };
    const runtimeHome = await ensureRuntimeHome(cwd, {
      envOverrides,
      dataFilePath,
      storagePath,
      mcpHostUrl: hostUrl,
      mcpToken: token
    }).catch(() => '');
    const workspacePaths = collectCodexWorkspacePaths({
      cwd,
      snapshot,
      storagePath,
      dataFilePath,
      cleanText
    });
    const skillReleases = await releaseSkillsForWorkspaces(
      workspacePaths,
      releaseOfficialSkills,
      { snapshot }
    );
    const result = {
      ok: Boolean(runtimeHome) && skillReleases.every((release) => release.ok !== false),
      status: 'initialized',
      host_url: hostUrl,
      has_token: Boolean(token),
      runtime_home: runtimeHome,
      data_file_path: dataFilePath,
      storage_path: storagePath,
      workspace_paths: workspacePaths,
      skill_releases: skillReleases
    };
    lastResult = result;
    return result;
  }

  function initialize(input = {}) {
    if (activeInitialization && input.force !== true) {
      return activeInitialization;
    }
    activeInitialization = runInitialization(input).finally(() => {
      activeInitialization = null;
    });
    return activeInitialization;
  }

  return {
    initialize,
    getLastResult: () => lastResult
  };
}

module.exports = {
  createCodexWorkspaceInitializer
};
