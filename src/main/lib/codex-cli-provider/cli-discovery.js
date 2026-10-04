'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readCodexManagedInstall } = require('./cli-managed');

// Keep discovery independent of shell startup files: desktop launches often have
// a minimal PATH. Options also let the Windows filesystem be tested on macOS.
function discoveryContext(env = process.env, options = {}) {
  const platform = options.platform || process.platform;
  const paths = platform === 'win32' ? path.win32 : path.posix;
  const home = options.home || os.homedir();
  const getEnv = (name) => String(env[Object.keys(env).find((key) =>
    platform === 'win32' ? key.toLowerCase() === name.toLowerCase() : key === name)] || '').trim();
  const fileSystem = options.fs || fs;
  const isFile = (candidate, executable = true) => {
    try {
      const stat = fileSystem.statSync(candidate);
      return stat.isFile() && (!executable || platform === 'win32' || (stat.mode & 0o111) !== 0);
    } catch { return false; }
  };
  const versions = (directory, suffix = '') => {
    try {
      return fileSystem.readdirSync(directory).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
        .map((name) => paths.join(directory, name, suffix));
    } catch { return []; }
  };
  const pathDirs = getEnv('PATH').split(platform === 'win32' ? ';' : ':')
    .map((value) => value.trim().replace(/^"(.*)"$/u, '$1')).filter(Boolean);
  const local = getEnv('LOCALAPPDATA') || paths.join(home, 'AppData', 'Local');
  const roaming = getEnv('APPDATA') || paths.join(home, 'AppData', 'Roaming');
  const privateNode = platform === 'win32'
    ? paths.join(local, 'HikariNode', 'node.exe')
    : paths.join(home, '.hikari', 'node', 'bin', 'node');
  // Homebrew's versioned node@NN formulae are keg-only (not linked into bin).
  const homebrewNodeKegs = (prefix) => versions(paths.join(prefix, 'opt'), 'bin')
    .filter((dir) => /^node(@\d+)?$/u.test(paths.basename(paths.dirname(dir))));
  const nodeDirs = platform === 'win32'
    ? [getEnv('NVM_SYMLINK'), 'C:\\nvm4w\\nodejs', paths.join(getEnv('ProgramFiles') || 'C:\\Program Files', 'nodejs'),
      paths.join(local, 'Programs', 'nodejs'), ...versions(getEnv('NVM_HOME') || paths.join(roaming, 'nvm')),
      ...versions(paths.join(local, 'nvm')),
      ...versions(paths.join(getEnv('FNM_DIR') || paths.join(roaming, 'fnm'), 'node-versions'), 'installation')]
    : ['/opt/homebrew/bin', '/usr/local/bin', '/opt/local/bin', '/usr/bin',
      ...homebrewNodeKegs('/opt/homebrew'), ...homebrewNodeKegs('/usr/local'),
      ...versions(paths.join(getEnv('NVM_DIR') || paths.join(home, '.nvm'), 'versions', 'node'), 'bin'),
      ...versions(paths.join(home, '.local', 'share', 'fnm', 'node-versions'), 'installation/bin'),
      ...versions(paths.join(getEnv('FNM_DIR') || paths.join(getEnv('XDG_DATA_HOME') || paths.join(home, '.local', 'share'), 'fnm'), 'node-versions'), 'installation/bin'),
      ...versions(paths.join(home, 'Library', 'Application Support', 'fnm', 'node-versions'), 'installation/bin')];
  const installDirs = [getEnv('CODEX_INSTALL_DIR'), paths.join(home, '.local', 'bin')];
  if (platform === 'win32') {
    installDirs.unshift(paths.join(local, 'Programs', 'OpenAI', 'Codex', 'bin'));
    installDirs.push(paths.join(roaming, 'npm'), paths.join(local, 'Volta', 'bin'),
      paths.join(local, 'Microsoft', 'WinGet', 'Links'), paths.join(getEnv('SCOOP') || paths.join(home, 'scoop'), 'shims'));
  } else {
    installDirs.push('/opt/homebrew/bin', '/usr/local/bin', paths.join(home, '.npm-global', 'bin'));
  }
  const npmPrefix = getEnv('NPM_CONFIG_PREFIX');
  if (npmPrefix) installDirs.push(platform === 'win32' ? npmPrefix : paths.join(npmPrefix, 'bin'));
  installDirs.push(paths.join(getEnv('VOLTA_HOME') || paths.join(home, '.volta'), 'bin'),
    paths.join(home, '.asdf', 'shims'), paths.join(home, '.bun', 'bin'), ...nodeDirs);
  return { platform, paths, home, getEnv, fileSystem, isFile, pathDirs, installDirs, nodeDirs, privateNode };
}

function commandCandidates(command, directories, ctx) {
  // npm ships an extensionless POSIX shell shim on Windows too. Never choose it
  // ahead of the Windows executable / npm entrypoint.
  const extensions = ctx.platform === 'win32' && !ctx.paths.extname(command)
    ? ['.exe', '.com', '.cmd', '.bat', ''] : [''];
  return directories.filter(Boolean).flatMap((dir) => extensions.map((ext) => ctx.paths.join(dir, command + ext)));
}

function resolveCodexBinary(env = process.env, options = {}) {
  const ctx = discoveryContext(env, options);
  const explicit = ctx.getEnv('HIKARI_CODEX_CLI') || ctx.getEnv('HIKARI_CODEX_BIN');
  // An override is authoritative; a typo must not silently launch another CLI.
  if (explicit) {
    if (/[/\\]/u.test(explicit)) return explicit;
    return commandCandidates(explicit, ctx.pathDirs, ctx).find((item) => ctx.isFile(item)) || explicit;
  }
  const managed = readCodexManagedInstall(env, options);
  if (managed) return managed.binary;
  const execPath = options.processExecPath ?? process.execPath;
  const resourcePath = options.resourcesPath ?? process.resourcesPath;
  const candidates = commandCandidates('codex', [
    ...ctx.installDirs.slice(0, ctx.platform === 'win32' ? 3 : 2),
    ...ctx.pathDirs, ...ctx.installDirs,
    resourcePath, execPath && ctx.paths.dirname(execPath)
  ], ctx);
  if (ctx.platform === 'darwin') {
    candidates.push('/Applications/Codex.app/Contents/Resources/codex',
      ctx.paths.join(ctx.home, 'Applications', 'Codex.app', 'Contents', 'Resources', 'codex'));
  }
  return [...new Set(candidates)].find((item) => ctx.isFile(item)) || 'codex';
}

function createCodexCliNotFoundError(cause = null) {
  const error = new Error('Codex CLI was not found. Install it using the command in Settings > Codex Model & Access, then click Check again.');
  error.code = 'ENOENT';
  if (cause) error.cause = cause;
  return error;
}

function executableUsesEnvNode(candidate, ctx) {
  let descriptor;
  try {
    descriptor = ctx.fileSystem.openSync(candidate, 'r');
    const buffer = Buffer.alloc(512);
    const count = ctx.fileSystem.readSync(descriptor, buffer, 0, buffer.length, 0);
    return /^#![^\r\n]*\benv(?:\s+-S)?\s+node(?:\s|$)/u.test(buffer.subarray(0, count).toString('utf8').split(/\r?\n/u, 1)[0]);
  } catch { return false; } finally {
    if (descriptor !== undefined) {
      try { ctx.fileSystem.closeSync(descriptor); } catch { /* Best-effort probe. */ }
    }
  }
}

function resolveCodexNodeBinary(codexBinary = '', env = process.env, options = {}) {
  const ctx = discoveryContext(env, options);
  const nodeName = ctx.platform === 'win32' ? 'node.exe' : 'node';
  const explicit = ctx.getEnv('HIKARI_CODEX_NODE_PATH') || ctx.getEnv('HIKARI_NODE_PATH');
  const execPath = options.processExecPath ?? process.execPath;
  const candidates = [];
  if (explicit) candidates.push(explicit, ...commandCandidates(explicit, ctx.pathDirs, ctx));
  if (codexBinary) candidates.push(ctx.paths.join(ctx.paths.dirname(codexBinary), nodeName));
  // npm's Unix bin symlink may point into a different Node installation.
  try {
    const real = ctx.fileSystem.realpathSync(codexBinary);
    const marker = `${ctx.paths.sep}lib${ctx.paths.sep}node_modules${ctx.paths.sep}`;
    if (real.includes(marker)) candidates.push(ctx.paths.join(real.split(marker)[0], 'bin', nodeName));
  } catch { /* Not a symlink or no longer installed. */ }
  if (/^node(?:\.exe)?$/iu.test(ctx.paths.basename(execPath || ''))) candidates.push(execPath);
  candidates.push(...commandCandidates(nodeName, ctx.pathDirs, ctx),
    ...(options.commonNodePaths || [ctx.privateNode, ...ctx.nodeDirs.filter(Boolean).map((dir) => ctx.paths.join(dir, nodeName))]));
  return candidates.find((item) => ctx.isFile(item)) || '';
}

function resolveCodexInvocation(env = process.env, options = {}) {
  const ctx = discoveryContext(env, options);
  const binary = options.codexBinary || resolveCodexBinary(env, options);
  let script = binary;
  if (ctx.platform === 'win32' && !/\.(exe|com)$/iu.test(binary)) {
    // Execute npm's JS entrypoint with Node, never through cmd.exe / shell:true:
    // prompts and paths can contain quotes, spaces, %, &, and other metacharacters.
    const npmScript = ctx.paths.join(ctx.paths.dirname(binary), 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
    if (ctx.isFile(npmScript, false)) script = npmScript;
    else if (!/\.[cm]?js$/iu.test(binary) && !executableUsesEnvNode(binary, ctx)) {
      throw createCodexCliNotFoundError();
    }
  } else if (!/\.[cm]?js$/iu.test(binary) && !executableUsesEnvNode(binary, ctx)) {
    return { command: binary, argsPrefix: [] };
  }
  const node = resolveCodexNodeBinary(binary, env, options);
  if (!node) {
    const error = new Error('Codex CLI needs Node.js, which Hikari could not find. Install the standalone Codex CLI using the command in Settings > Codex Model & Access.');
    error.code = 'ENOENT';
    throw error;
  }
  return { command: node, argsPrefix: [script] };
}

function getCodexCliAvailability(env = process.env, options = {}) {
  const ctx = discoveryContext(env, options);
  const result = {
    cliAvailable: false,
    cliPath: '',
    cliMessage: '',
    cliInstallCommand: ctx.platform === 'win32'
      ? 'powershell -ExecutionPolicy ByPass -c "irm https://chatgpt.com/codex/install.ps1 | iex"'
      : 'curl -fsSL https://chatgpt.com/codex/install.sh | sh',
    cliInstallShell: ctx.platform === 'win32' ? 'PowerShell' : 'Terminal'
  };
  try {
    const binary = resolveCodexBinary(env, options);
    if (!ctx.isFile(binary)) throw createCodexCliNotFoundError();
    resolveCodexInvocation(env, { ...options, codexBinary: binary });
    result.cliAvailable = true;
    result.cliPath = binary;
  } catch (error) { result.cliMessage = error.message; }
  return result;
}

module.exports = {
  HIKARI_PRIVATE_NODE_PATH: discoveryContext().privateNode,
  createCodexCliNotFoundError,
  getCodexCliAvailability,
  resolveCodexBinary,
  resolveCodexInvocation,
  resolveCodexNodeBinary
};
