'use strict';

const {
  CODEX_PROJECT_DOC_MAX_BYTES,
  CODEX_PROJECT_MEMORY_FILE
} = require('./constants');
const { getCodexCliCatalog } = require('./catalog');
const { resolveCodexRequestSelection } = require('./runtime-gateway');
const { normalizeCodexSessionId } = require('./session-id');

function appendCodexCliModelArgs(args, {
  model = '',
  reasoningEffort = '',
  catalog = null,
  selection = null
} = {}) {
  const resolved = selection || resolveCodexRequestSelection({ model, reasoningEffort, catalog });
  if (resolved.model) args.push('-m', resolved.model);
  if (resolved.reasoningEffort) args.push('-c', `model_reasoning_effort=${resolved.reasoningEffort}`);
  return args;
}

function appendCodexProjectMemoryConfigArgs(args) {
  args.push(
    '-c',
    `project_doc_fallback_filenames=["${CODEX_PROJECT_MEMORY_FILE}"]`,
    '-c',
    `project_doc_max_bytes=${CODEX_PROJECT_DOC_MAX_BYTES}`
  );
  return args;
}

function appendFileAccessToken(args, token = '') {
  // Always override, including for helpers with no grant. A concurrent turn may
  // rewrite config.toml, but it cannot grant its capability to this invocation.
  const value = /^[a-f0-9-]{36}$/u.test(token) ? token : '';
  args.push('-c', `mcp_servers.hikari.env.HIKARI_FILE_ACCESS_TOKEN=${JSON.stringify(value)}`);
}

function buildCodexCliExecArgs({
  outputFile = '',
  outputSchemaFile = '',
  model = '',
  reasoningEffort = '',
  enableWebSearch = false,
  enableImageGeneration = false,
  fileAccessToken = '',
  catalog = getCodexCliCatalog(),
  selection = null,
  streamJson = false
} = {}) {
  const args = [
    '-a', 'never',
    '-s', 'read-only'
  ];
  if (enableWebSearch === true) {
    args.push('--search');
  }
  if (enableImageGeneration === true) {
    args.push('-c', 'features.image_generation=true');
  }
  args.push(
    'exec',
    '--skip-git-repo-check',
    '--output-last-message', outputFile,
    '--color', 'never'
  );
  if (streamJson === true) {
    args.push('--json');
  }
  if (outputSchemaFile) {
    args.push('--output-schema', outputSchemaFile);
  }
  appendCodexCliModelArgs(args, { model, reasoningEffort, catalog, selection });
  appendCodexProjectMemoryConfigArgs(args);
  appendFileAccessToken(args, fileAccessToken);
  args.push('-');
  return args;
}

function buildCodexCliExecResumeArgs({
  outputFile = '',
  outputSchemaFile = '',
  sessionId = '',
  useLastSession = false,
  model = '',
  reasoningEffort = '',
  enableWebSearch = false,
  enableImageGeneration = false,
  fileAccessToken = '',
  catalog = getCodexCliCatalog(),
  selection = null,
  streamJson = false
} = {}) {
  const args = [
    '-a', 'never',
    '-s', 'read-only'
  ];
  if (enableWebSearch === true) {
    args.push('--search');
  }
  if (enableImageGeneration === true) {
    args.push('-c', 'features.image_generation=true');
  }
  args.push(
    'exec',
    'resume',
    '--skip-git-repo-check',
    '--output-last-message', outputFile
  );
  if (streamJson === true) {
    args.push('--json');
  }
  if (outputSchemaFile) {
    args.push('--output-schema', outputSchemaFile);
  }
  appendCodexCliModelArgs(args, { model, reasoningEffort, catalog, selection });
  appendCodexProjectMemoryConfigArgs(args);
  appendFileAccessToken(args, fileAccessToken);
  const cleanSessionId = normalizeCodexSessionId(sessionId);
  if (cleanSessionId) {
    args.push(cleanSessionId);
  } else if (useLastSession === true) {
    args.push('--last');
  }
  args.push('-');
  return args;
}

module.exports = {
  appendCodexCliModelArgs,
  appendCodexProjectMemoryConfigArgs,
  buildCodexCliExecArgs,
  buildCodexCliExecResumeArgs
};
