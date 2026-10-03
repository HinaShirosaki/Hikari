'use strict';

const fsSync = require('node:fs');
const path = require('node:path');
const { cleanText, safeParseJson } = require('./utils');
const {
  getCodexCliAuthFilePath,
  getCodexCliCandidateHomeDirectories
} = require('./paths');

function readCodexCliAuthFile(env = process.env) {
  const candidates = getCodexCliCandidateHomeDirectories(env);
  for (const homeDirectory of candidates) {
    try {
      const authPath = path.join(homeDirectory, 'auth.json');
      const parsed = safeParseJson(fsSync.readFileSync(authPath, 'utf8'), null);
      if (parsed && typeof parsed === 'object') {
        return {
          authFile: parsed,
          sourcePath: authPath
        };
      }
    } catch {
      // Continue to the next home candidate.
    }
  }
  return null;
}

function decodeJwtPayload(token = '') {
  const cleanToken = String(token || '').trim();
  const parts = cleanToken.split('.');
  if (parts.length < 2 || !parts[1]) {
    return null;
  }
  const normalized = parts[1].replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4 || 4)) % 4);
  try {
    return safeParseJson(Buffer.from(padded, 'base64').toString('utf8'), null);
  } catch {
    return null;
  }
}

function resolveCodexCliAccessTokenExpiry(accessToken = '') {
  const payload = decodeJwtPayload(accessToken);
  const expSeconds = Number(payload?.exp);
  if (!Number.isFinite(expSeconds) || expSeconds <= 0) {
    return 0;
  }
  return expSeconds * 1000;
}

function isCodexCliAccessTokenExpired(accessToken = '') {
  const expiresAt = resolveCodexCliAccessTokenExpiry(accessToken);
  return Boolean(expiresAt && Date.now() >= expiresAt);
}

function readCodexCliOAuthProfile(env = process.env) {
  const authFileState = readCodexCliAuthFile(env);
  const authFile = authFileState?.authFile;
  const authMode = cleanText(authFile?.auth_mode, 40).toLowerCase();
  const accessToken = cleanText(authFile?.tokens?.access_token, 20000);
  const refreshToken = cleanText(authFile?.tokens?.refresh_token, 20000);
  const accountId = cleanText(authFile?.tokens?.account_id, 400);
  const expiresAt = resolveCodexCliAccessTokenExpiry(accessToken);
  return {
    authMode,
    accessToken,
    refreshToken,
    accountId,
    expiresAt,
    expired: Boolean(expiresAt && Date.now() >= expiresAt),
    sourcePath: cleanText(authFileState?.sourcePath, 2400) || getCodexCliAuthFilePath(env)
  };
}

module.exports = {
  decodeJwtPayload,
  isCodexCliAccessTokenExpired,
  readCodexCliAuthFile,
  readCodexCliOAuthProfile,
  resolveCodexCliAccessTokenExpiry
};
