'use strict';

const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const path = require('node:path');
const { codexInstallDirectory } = require('./cli-managed');
const exec = promisify(execFile);

function nativeUpdateEnvironment(env, platform = process.platform) {
  const directory = codexInstallDirectory(env, { platform });
  const pathKey = Object.keys(env).find(key => key.toLowerCase() === 'path') || 'PATH';
  return { ...env, CODEX_HOME: env.HIKARI_CODEX_HOME || env.CODEX_HOME,
    CODEX_INSTALL_DIR: directory, CODEX_NON_INTERACTIVE: '1',
    [pathKey]: `${directory}${platform === 'win32' ? ';' : path.delimiter}${env[pathKey] || ''}` };
}

async function runNativeCodexUpdate(binary, { env, signal, platform = process.platform } = {}) {
  await exec(binary, ['update'], { env: nativeUpdateEnvironment(env, platform), signal,
    timeout: 5 * 60 * 1000, windowsHide: true, maxBuffer: 1024 * 1024 });
}

function isNativeUpdateUnsupported(error) {
  return /unrecognized subcommand ['"]?update|could not detect the Codex installation method|self.update (?:is )?not supported/i
    .test(`${error?.stderr || ''}\n${error?.message || ''}`);
}

module.exports = { nativeUpdateEnvironment, runNativeCodexUpdate, isNativeUpdateUnsupported };
