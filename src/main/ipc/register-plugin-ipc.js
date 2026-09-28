'use strict';

const path = require('node:path');
const { PLUGINS } = require('../../shared/ipc/channels');
const { inspectPluginFolder } = require('../lib/inspect-plugin-folder');
const { readPluginFile, writePluginFile } = require('../lib/plugin-files');
const { createPluginServerRegistry } = require('../lib/plugin-server');

const MAX_PLUGIN_EXPORT_BASE64_CHARS = 24_000_000;
const BUNDLED_PLUGIN_TOKEN_PATTERN = /^@bundled\/([a-z0-9]+(?:-[a-z0-9]+)*)$/;

function resolvePluginServePath({ pluginId, requestedPath, getBundledPluginPath }) {
  if (!String(requestedPath || '').startsWith('@bundled/')) return requestedPath;
  const match = BUNDLED_PLUGIN_TOKEN_PATTERN.exec(String(requestedPath || ''));
  if (!match || match[1] !== pluginId) {
    throw new Error(`Invalid bundled plugin path for "${pluginId}".`);
  }
  const resolvedPath = getBundledPluginPath(pluginId);
  if (!resolvedPath) throw new Error(`Unknown bundled plugin "${pluginId}".`);
  return resolvedPath;
}

function isCanonicalBase64(value) {
  const encoded = String(value || '');
  if (!encoded || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) return false;
  try {
    return Buffer.from(encoded, 'base64').toString('base64') === encoded;
  } catch {
    return false;
  }
}

function normalizePayload(payload) {
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) return payload;
  try {
    const parsed = JSON.parse(String(payload || ''));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function sanitizePluginExportFileName(fileName) {
  const rawName = path.basename(String(fileName || 'plugin-export.dat').trim());
  const ext = path.extname(rawName).replace(/[^.\w-]+/g, '').slice(0, 24);
  const base = rawName.slice(0, Math.max(0, rawName.length - ext.length));
  const safeBase = base
    .replace(/[<>:"/\\|?*\x00-\x1F]+/g, '_')
    .replace(/\s+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 180) || 'plugin-export';
  return `${safeBase}${ext}`;
}

function registerPluginIpc(deps = {}) {
  const { ipcMain, session, dialog, fs } = deps;
  const cleanText = typeof deps.cleanText === 'function'
    ? deps.cleanText
    : ((value, maxLength = 2400) => String(value || '').trim().slice(0, maxLength));
  const getBundledPluginPath = typeof deps.getBundledPluginPath === 'function'
    ? deps.getBundledPluginPath
    : (() => '');

  const pluginServers = createPluginServerRegistry({
    prepareOrigin: async (baseUrl) => {
      if (!session?.defaultSession) {
        throw new Error('Plugin origins cannot be isolated without an Electron session.');
      }
      await session.defaultSession.clearStorageData({ origin: new URL(baseUrl).origin });
    }
  });

  ipcMain.handle(PLUGINS.INSPECT_FOLDER, async (_event, payload) => {
    try {
      return await inspectPluginFolder({ fs, folderPath: normalizePayload(payload).path });
    } catch (error) {
      return { ok: false, error: String(error?.message || error) };
    }
  });

  ipcMain.handle(PLUGINS.SERVE_FOLDER, async (_event, payload) => {
    const input = normalizePayload(payload);
    try {
      if (!session?.defaultSession) {
        throw new Error('Plugin origins cannot be isolated without an Electron session.');
      }
      const pluginId = cleanText(input.id, 80);
      const requestedPath = cleanText(input.path, 2400);
      const resolvedPath = resolvePluginServePath({ pluginId, requestedPath, getBundledPluginPath });
      return await pluginServers.serve(pluginId, resolvedPath);
    } catch (error) {
      return { ok: false, error: String(error?.message || error) };
    }
  });

  for (const [channel, operation] of [
    [PLUGINS.READ_FILE, readPluginFile],
    [PLUGINS.WRITE_FILE, writePluginFile]
  ]) {
    ipcMain.handle(channel, async (_event, payload) => {
      try {
        return { ok: true, ...await operation(payload) };
      } catch (error) {
        return {
          ok: false,
          error: error?.code
            ? `Plugin file operation failed (${error.code}).`
            : String(error?.message || error)
        };
      }
    });
  }

  ipcMain.handle(PLUGINS.EXPORT_FILE, async (_event, payload) => {
    const input = normalizePayload(payload);
    const dataBase64 = String(input.dataBase64 || '');
    if (!dataBase64) return { ok: false, error: 'Missing export data.' };
    if (dataBase64.length > MAX_PLUGIN_EXPORT_BASE64_CHARS) {
      return { ok: false, error: 'Plugin export is too large.' };
    }
    if (!isCanonicalBase64(dataBase64)) {
      return { ok: false, error: 'Plugin export data is not valid base64.' };
    }
    const suggestedName = sanitizePluginExportFileName(input.fileName);
    try {
      const result = await dialog.showSaveDialog({ title: 'Export Plugin File', defaultPath: suggestedName });
      if (result.canceled || !result.filePath) return { ok: false, canceled: true };
      await fs.writeFile(result.filePath, Buffer.from(dataBase64, 'base64'));
      return { ok: true, saved: true, fileName: path.basename(result.filePath) };
    } catch (error) {
      return { ok: false, error: String(error?.message || error) };
    }
  });

  return pluginServers;
}

module.exports = { isCanonicalBase64, registerPluginIpc, resolvePluginServePath };
