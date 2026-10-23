'use strict';

const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { randomUUID } = require('node:crypto');
const path = require('node:path');
const { inspectPluginFolder } = require('./inspect-plugin-folder');

const execFileAsync = promisify(execFile);
const PLUGIN_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function normalizeGitHubRepositoryUrl(value) {
  const input = typeof value === 'string' ? value.trim() : '';
  const match = /^https:\/\/github\.com\/([a-z0-9-]{1,39})\/([a-z0-9_.-]{1,104})\/?$/i.exec(input);
  const repository = match?.[2].replace(/\.git$/i, '');
  if (!match || !repository || repository === '.' || repository === '..' || repository.length > 100) {
    throw new Error('Enter a GitHub repository URL such as https://github.com/owner/plugin-repo.');
  }
  return `https://github.com/${match[1]}/${repository}`;
}

async function checkRepositoryFiles(fs, folder) {
  for (const entry of await fs.readdir(folder, { withFileTypes: true })) {
    if (entry.name === '.git') continue;
    if (entry.isSymbolicLink() || (!entry.isDirectory() && !entry.isFile())) {
      throw new Error('Plugin repositories must contain regular files and folders, without symbolic links.');
    }
    if (entry.isDirectory()) await checkRepositoryFiles(fs, path.join(folder, entry.name));
  }
}

function createGitHubPluginInstaller({ fs, getInstallRoot, runGit = execFileAsync }) {
  let installing = false;

  return async function installGitHubPlugin({ url, installedPluginIds = [] } = {}) {
    const repositoryUrl = normalizeGitHubRepositoryUrl(url);
    if (installing) throw new Error('A plugin installation is already in progress.');
    installing = true;
    let stagingPath = '';
    let committedPath = '';
    try {
      const root = getInstallRoot?.();
      if (!root || !path.isAbsolute(root)) throw new Error('The plugin installation folder is unavailable.');
      await fs.mkdir(root, { recursive: true });
      stagingPath = await fs.mkdtemp(path.join(root, '.install-'));
      const checkout = path.join(stagingPath, '.repository');
      const hooks = path.join(stagingPath, '.hooks');
      await fs.mkdir(hooks);
      try {
        await runGit('git', [
          '-c', `core.hooksPath=${hooks}`,
          '-c', 'protocol.allow=never',
          '-c', 'protocol.https.allow=always',
          '-c', 'http.followRedirects=false',
          '-c', 'credential.interactive=false',
          'clone', '--depth=1', '--single-branch', '--no-recurse-submodules', '--template=',
          '--', `${repositoryUrl}.git`, checkout
        ], {
          cwd: stagingPath,
          env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_LFS_SKIP_SMUDGE: '1' },
          timeout: 120_000,
          killSignal: 'SIGKILL',
          maxBuffer: 1024 * 1024,
          windowsHide: true
        });
      } catch (error) {
        const stderr = String(error.stderr || '').trim();
        // Without Command Line Tools, macOS's /usr/bin/git is a shim that exits non-zero.
        if (error.code === 'ENOENT' || /^(xcrun: error|xcode-select: note)/m.test(stderr)) {
          throw new Error('Git is required. Install Git, restart Hikari, and try again.');
        }
        if (error.killed) throw new Error('Cloning timed out. Check your connection and try again.');
        const detail = stderr.split('\n').pop().trim().slice(0, 300);
        throw new Error(`Could not clone the repository. Check the URL, your internet connection, and repository access.${detail ? ` Git said: ${detail}` : ''}`);
      }

      await checkRepositoryFiles(fs, checkout);
      let manifest;
      try {
        const manifestPath = path.join(checkout, 'plugin.json');
        const stat = await fs.lstat(manifestPath);
        if (!stat.isFile() || stat.size > 64 * 1024) throw new Error('Invalid manifest file.');
        manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
      } catch {
        throw new Error('The repository must contain a valid plugin.json at its root, ready to install.');
      }
      const id = manifest?.id;
      if (typeof id !== 'string' || id.length > 80 || !PLUGIN_ID_PATTERN.test(id)) {
        throw new Error('plugin.json must declare a lower-case kebab-case plugin id.');
      }
      // Repository names need not match plugin ids; the installed folder must.
      const pluginPath = path.join(stagingPath, id);
      await fs.rename(checkout, pluginPath);
      const inspected = await inspectPluginFolder({ fs, folderPath: pluginPath });
      if (!inspected.ok) throw new Error(inspected.error);
      if (Array.isArray(installedPluginIds) && installedPluginIds.includes(inspected.id)) {
        throw new Error(`A plugin named "${inspected.name}" is already installed.`);
      }
      await fs.rm(hooks, { recursive: true, force: true });
      committedPath = path.join(root, randomUUID());
      await fs.rename(stagingPath, committedPath);
      stagingPath = '';
      const installed = await inspectPluginFolder({ fs, folderPath: path.join(committedPath, id) });
      if (!installed.ok) throw new Error(installed.error);
      committedPath = '';
      return { ...installed, repositoryUrl };
    } finally {
      try {
        if (stagingPath) await fs.rm(stagingPath, { recursive: true, force: true });
        if (committedPath) await fs.rm(committedPath, { recursive: true, force: true });
      } finally {
        installing = false;
      }
    }
  };
}

module.exports = { createGitHubPluginInstaller, normalizeGitHubRepositoryUrl };
