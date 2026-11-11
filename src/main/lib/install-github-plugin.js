'use strict';

const { randomUUID } = require('node:crypto');
const path = require('node:path');
const { inspectPluginFolder } = require('./inspect-plugin-folder');
const { extractTarGz } = require('./tutorial-download');

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
    if (entry.isSymbolicLink() || (!entry.isDirectory() && !entry.isFile())) {
      throw new Error('Plugin repositories must contain regular files and folders, without symbolic links.');
    }
    if (entry.isDirectory()) await checkRepositoryFiles(fs, path.join(folder, entry.name));
  }
}

// GitHub serves the default branch (HEAD) as a tarball, so installing needs no
// Git: the system bsdtar unpacks it. bsdtar refuses `..` paths and writing
// through symbolic links; checkRepositoryFiles then rejects any link it made.
// ponytail: the archive is held in memory, fine for plugin-sized repositories.
async function downloadRepository(repositoryUrl, destination, { fetchImpl = fetch, extract = extractTarGz } = {}) {
  const repository = new URL(repositoryUrl).pathname;
  let response, archive;
  try {
    response = await fetchImpl(`https://codeload.github.com${repository}/tar.gz/HEAD`, { signal: AbortSignal.timeout(120_000) });
    if (response.ok) archive = Buffer.from(await response.arrayBuffer());
  } catch (error) {
    if (error?.name === 'TimeoutError') throw new Error('The download timed out. Check your connection and try again.');
    throw new Error('Could not download the repository. Check your internet connection and try again.');
  }
  if (!response.ok) {
    throw new Error(response.status === 404
      ? 'GitHub has no public repository at that URL. Check the URL and that the repository is public.'
      : `Could not download the repository (GitHub answered ${response.status}).`);
  }
  await extract(archive, destination);
}

function createGitHubPluginInstaller({ fs, getInstallRoot, download = downloadRepository }) {
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
      await fs.mkdir(checkout);
      await download(repositoryUrl, checkout);

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

module.exports = { createGitHubPluginInstaller, downloadRepository, normalizeGitHubRepositoryUrl };
