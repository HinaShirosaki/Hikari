module.exports = function registerGitHubInstallSuite(context = {}) {
  const { assert, fsPromises: fs, path, test } = context.scope;
  const root = context.__dirname;
  const { createGitHubPluginInstaller, normalizeGitHubRepositoryUrl } = require(
    path.join(root, 'src/main/lib/install-github-plugin.js')
  );
  const { execFile } = require('node:child_process');
  const exec = require('node:util').promisify(execFile);
  const manifest = { id: 'my-plugin', name: 'My Plugin', version: '1.0.0', permissions: ['storage'] };

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

  test('plugin system: GitHub installer clones a real repository and keeps final paths after staging', async () => {
    const temp = await fs.mkdtemp(path.join(root, 'tmp', 'github-clone-'));
    const repository = path.join(temp, 'different-repository-name');
    const installs = path.join(temp, 'installed');
    try {
      await fs.mkdir(repository);
      await fs.writeFile(path.join(repository, 'plugin.json'), JSON.stringify(manifest));
      await fs.writeFile(path.join(repository, 'index.html'), '<!doctype html><h1>My Plugin</h1>');
      await exec('git', ['init', repository]);
      await exec('git', ['-C', repository, 'add', '.']);
      await exec('git', ['-C', repository, '-c', 'user.name=QA', '-c', 'user.email=qa@example.test',
        '-c', 'core.hooksPath=', '-c', 'commit.gpgsign=false', 'commit', '-m', 'Plugin fixture']);
      const { pathToFileURL } = require('node:url');
      const clone = async (command, args, options) => {
        assert.equal(command, 'git');
        assert.equal(args.at(-2), 'https://github.com/owner/different-repository-name.git');
        assert.equal(options.env.GIT_TERMINAL_PROMPT, '0');
        assert.equal(options.windowsHide, true);
        assert.ok(args.includes('--no-recurse-submodules'));
        // Redirect only the test fixture's GitHub URL to a local Git repository.
        return exec(command, ['-c', `url.${pathToFileURL(repository).href}.insteadOf=${args.at(-2)}`,
          '-c', 'protocol.file.allow=always', ...args], options);
      };
      const install = createGitHubPluginInstaller({ fs, getInstallRoot: () => installs, runGit: clone });
      const result = await install({ url: 'https://github.com/owner/different-repository-name.git' });
      assert.equal(result.ok, true);
      assert.equal(result.id, 'my-plugin');
      assert.equal(path.basename(result.path), 'my-plugin');
      assert.equal(result.repositoryUrl, 'https://github.com/owner/different-repository-name');
      assert.equal(result.entryUrl, pathToFileURL(path.join(result.path, 'index.html')).href);
      assert.deepEqual(result.permissions, ['storage']);
      assert.match(await fs.readFile(path.join(result.path, 'index.html'), 'utf8'), /My Plugin/);
      assert.ok((await fs.stat(path.join(result.path, '.git'))).isDirectory(), 'retains the cloned repository');
      const before = await fs.readdir(installs);
      await assert.rejects(install({ url: result.repositoryUrl, installedPluginIds: ['my-plugin'] }), /already installed/);
      assert.deepEqual(await fs.readdir(installs), before, 'duplicate install leaves the existing checkout untouched');
    } finally {
      await fs.rm(temp, { recursive: true, force: true });
    }
  });

  test('plugin system: GitHub installer cleans failed clones and invalid manifests and permits retry', async () => {
    const temp = await fs.mkdtemp(path.join(root, 'tmp', 'github-errors-'));
    let mode = 'missing-git';
    let calls = 0;
    const install = createGitHubPluginInstaller({
      fs, getInstallRoot: () => temp,
      runGit: async (_command, args) => {
        calls += 1;
        const checkout = args.at(-1);
        await fs.mkdir(checkout);
        if (mode === 'missing-git') throw Object.assign(new Error('spawn failed'), { code: 'ENOENT' });
        if (mode === 'timeout') throw Object.assign(new Error('killed'), { killed: true });
        if (mode === 'network') throw Object.assign(new Error('remote failure'), { stderr: "Cloning into '.repository'...\nfatal: repository 'https://github.com/owner/repo.git/' not found\n" });
        if (mode === 'no-clt') throw Object.assign(new Error('exit 1'), { code: 1, stderr: 'xcode-select: note: No developer tools were found, requesting install.\n' });
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
        ['missing-git', /Git is required/], ['no-clt', /Git is required/], ['timeout', /timed out/],
        ['network', /Could not clone .* Git said: fatal: repository '.*' not found$/],
        ['missing-manifest', /plugin.json at its root/], ['traversal', /plugin id/],
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
    const install = createGitHubPluginInstaller({ fs, getInstallRoot: () => temp, runGit: async () => {
      await gate;
      throw new Error('offline');
    } });
    try {
      const pending = assert.rejects(install({ url: 'https://github.com/owner/repo' }), /Could not clone/);
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
