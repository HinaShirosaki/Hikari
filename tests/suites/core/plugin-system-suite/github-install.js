module.exports = function registerGitHubInstallSuite(context = {}) {
  const { assert, fsPromises: fs, path, test } = context.scope;
  const root = context.__dirname;
  const { createGitHubPluginInstaller, downloadRepository, normalizeGitHubRepositoryUrl } = require(
    path.join(root, 'src/main/lib/install-github-plugin.js')
  );
  const { execFileSync } = require('node:child_process');
  const manifest = { id: 'my-plugin', name: 'My Plugin', version: '1.0.0', permissions: ['storage'] };
  // GitHub's codeload tarballs wrap the branch in one `<repo>-HEAD/` folder.
  const tarball = async (folder, files) => {
    const top = path.join(folder, 'repo-HEAD');
    await fs.mkdir(top, { recursive: true });
    for (const [name, body] of Object.entries(files)) {
      await fs.mkdir(path.dirname(path.join(top, name)), { recursive: true });
      if (body.symlink) await fs.symlink(body.symlink, path.join(top, name));
      else await fs.writeFile(path.join(top, name), body);
    }
    return execFileSync('tar', ['-czf', '-', '-C', folder, 'repo-HEAD']);
  };
  const respond = (body, status = 200) => new Response(body, { status });

  test('plugin system: GitHub URLs accept repository links and reject other hosts, credentials, and paths', () => {
    assert.equal(normalizeGitHubRepositoryUrl(' https://github.com/Owner/Plugin-Repo.git/ '), 'https://github.com/Owner/Plugin-Repo');
    assert.equal(normalizeGitHubRepositoryUrl('https://github.com/owner/repo'), 'https://github.com/owner/repo');
    for (const url of [
      '', null, 'http://github.com/owner/repo', 'git@github.com:owner/repo.git',
      'https://github.com.evil.test/owner/repo', 'https://evil.test/owner/repo',
      'https://user:secret@github.com/owner/repo', 'https://github.com:443/owner/repo',
      'https://github.com/owner/repo/tree/main', 'https://github.com/owner/repo?x=1',
      'https://github.com/owner/repo#main', 'https://github.com/owner/..',
      'https://github.com/owner/%2e%2e', 'https://github.com/owner/repo;touch bad'
    ]) assert.throws(() => normalizeGitHubRepositoryUrl(url), /GitHub repository URL/);
  });

  test('plugin system: GitHub installer unpacks the default-branch tarball and keeps final paths after staging', async () => {
    const temp = await fs.mkdtemp(path.join(root, 'tmp', 'github-download-'));
    const installs = path.join(temp, 'installed');
    try {
      const archive = await tarball(path.join(temp, 'fixture'), {
        'plugin.json': JSON.stringify(manifest), 'index.html': '<!doctype html><h1>My Plugin</h1>', 'assets/app.js': 'export {};'
      });
      const requested = [];
      const fetchImpl = async (url, options) => {
        requested.push(url);
        assert.ok(options.signal, 'the download has a timeout');
        return respond(archive);
      };
      const install = createGitHubPluginInstaller({ fs, getInstallRoot: () => installs,
        download: (url, destination) => downloadRepository(url, destination, { fetchImpl }) });
      const result = await install({ url: 'https://github.com/owner/different-repository-name.git' });
      assert.deepEqual(requested, ['https://codeload.github.com/owner/different-repository-name/tar.gz/HEAD']);
      assert.equal(result.ok, true);
      assert.equal(result.id, 'my-plugin');
      assert.equal(path.basename(result.path), 'my-plugin');
      assert.equal(result.repositoryUrl, 'https://github.com/owner/different-repository-name');
      const { pathToFileURL } = require('node:url');
      assert.equal(result.entryUrl, pathToFileURL(path.join(result.path, 'index.html')).href);
      assert.deepEqual(result.permissions, ['storage']);
      assert.match(await fs.readFile(path.join(result.path, 'index.html'), 'utf8'), /My Plugin/);
      assert.equal(await fs.readFile(path.join(result.path, 'assets', 'app.js'), 'utf8'), 'export {};', 'the wrapping folder is stripped');
      const before = await fs.readdir(installs);
      await assert.rejects(install({ url: result.repositoryUrl, installedPluginIds: ['my-plugin'] }), /already installed/);
      assert.deepEqual(await fs.readdir(installs), before, 'duplicate install leaves the existing copy untouched');
      if (process.platform !== 'win32') {
        const linked = await tarball(path.join(temp, 'linked'), {
          'plugin.json': JSON.stringify({ ...manifest, id: 'linked' }), 'index.html': '<h1>x</h1>', 'secret': { symlink: '/etc/hosts' }
        });
        const linkedInstall = createGitHubPluginInstaller({ fs, getInstallRoot: () => installs,
          download: (url, destination) => downloadRepository(url, destination, { fetchImpl: async () => respond(linked) }) });
        await assert.rejects(linkedInstall({ url: 'https://github.com/owner/linked' }), /symbolic links/);
        assert.deepEqual(await fs.readdir(installs), before, 'a rejected archive leaves no staging folder');
      }
    } finally {
      await fs.rm(temp, { recursive: true, force: true });
    }
  });

  test('plugin system: GitHub downloads explain missing, refused, offline, and slow repositories', async () => {
    const download = (fetchImpl) => downloadRepository('https://github.com/owner/repo', '/unused', {
      fetchImpl, extract: async () => assert.fail('nothing to unpack')
    });
    await assert.rejects(download(async () => respond('Not Found', 404)), /no public repository at that URL/);
    await assert.rejects(download(async () => respond('busy', 503)), /GitHub answered 503/);
    await assert.rejects(download(async () => { throw new TypeError('fetch failed'); }), /Check your internet connection/);
    await assert.rejects(download(async () => { throw new DOMException('timed out', 'TimeoutError'); }), /timed out/);
  });

  test('plugin system: GitHub installer cleans failed downloads and invalid manifests and permits retry', async () => {
    const temp = await fs.mkdtemp(path.join(root, 'tmp', 'github-errors-'));
    let mode = 'offline';
    let calls = 0;
    const install = createGitHubPluginInstaller({
      fs, getInstallRoot: () => temp,
      download: async (_url, checkout) => {
        calls += 1;
        if (mode === 'offline') throw new Error('Could not download the repository. Check your internet connection and try again.');
        if (mode === 'missing-manifest') return;
        await fs.writeFile(path.join(checkout, 'plugin.json'), JSON.stringify({
          ...manifest,
          ...(mode === 'traversal' ? { id: '../escape' } : {}),
          ...(mode === 'permissions' ? { permissions: ['bad:permission'] } : {})
        }));
        if (mode !== 'missing-entry') await fs.writeFile(path.join(checkout, 'index.html'), '<h1>Plugin</h1>');
        if (mode === 'symlink') await fs.symlink(path.join(temp, 'outside'), path.join(checkout, 'linked'));
      }
    });
    try {
      await assert.rejects(install({ url: 'https://evil.test/a/b' }), /GitHub repository URL/);
      assert.equal(calls, 0);
      for (const [failure, message] of [
        ['offline', /internet connection/], ['missing-manifest', /plugin.json at its root/], ['traversal', /plugin id/],
        ['permissions', /Unknown permission/], ['missing-entry', /index.html/], ['symlink', /symbolic links/]
      ]) {
        mode = failure;
        await assert.rejects(install({ url: 'https://github.com/owner/repo' }), message);
        assert.deepEqual(await fs.readdir(temp), [], `cleans up ${failure}`);
      }
      mode = 'success';
      assert.equal((await install({ url: 'https://github.com/owner/repo' })).ok, true);
    } finally {
      await fs.rm(temp, { recursive: true, force: true });
    }
  });

  test('plugin system: GitHub installer serializes concurrent requests', async () => {
    const temp = await fs.mkdtemp(path.join(root, 'tmp', 'github-busy-'));
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const install = createGitHubPluginInstaller({ fs, getInstallRoot: () => temp, download: async () => {
      await gate;
      throw new Error('Could not download the repository. Check your internet connection and try again.');
    } });
    try {
      const pending = assert.rejects(install({ url: 'https://github.com/owner/repo' }), /Could not download/);
      await assert.rejects(install({ url: 'https://github.com/owner/other' }), /already in progress/);
      release();
      await pending;
      assert.deepEqual(await fs.readdir(temp), []);
    } finally {
      release();
      await fs.rm(temp, { recursive: true, force: true });
    }
  });
};
