module.exports = function registerCliDiscovery(context = {}) {
  const { test } = context.scope;
  const assert = require('node:assert/strict');
  const path = require('node:path');
  const {
    resolveCodexBinary, resolveCodexInvocation, getCodexCliAvailability
  } = require('../../../../src/main/lib/codex-cli-provider/cli-discovery');

  function fixture(platform, files = {}, directories = {}) {
    const windows = platform === 'win32';
    const key = (value) => windows ? value.toLowerCase() : value;
    const entries = new Map(Object.entries(files).map(([name, contents]) => [key(name), contents]));
    const missing = () => { throw Object.assign(new Error('missing'), { code: 'ENOENT' }); };
    return {
      platform,
      home: windows ? 'C:\\Users\\Test User' : '/Users/test',
      processExecPath: windows ? 'C:\\Program Files\\Hikari\\Hikari.exe' : '/Applications/Hikari.app/Contents/MacOS/Hikari',
      resourcesPath: '',
      fs: {
        statSync(name) { return entries.has(key(name)) ? { isFile: () => true, mode: 0o755 } : missing(); },
        readdirSync(name) { return directories[name] || []; },
        realpathSync(name) { return name; },
        openSync(name) { return entries.has(key(name)) ? name : missing(); },
        readSync(name, buffer) { return buffer.write(entries.get(key(name)) || 'native'); },
        closeSync() {}
      }
    };
  }

  for (const platform of ['darwin', 'win32']) {
    const p = platform === 'win32' ? path.win32 : path.posix;
    const base = fixture(platform);
    const executable = platform === 'win32'
      ? p.join(base.home, 'AppData', 'Local', 'Programs', 'OpenAI', 'Codex', 'bin', 'codex.exe')
      : p.join(base.home, '.local', 'bin', 'codex');
    test(`Codex discovery finds standalone ${platform} installs without PATH`, () => {
      const options = fixture(platform, { [executable]: '' });
      assert.equal(resolveCodexBinary({}, options), executable);
      assert.deepEqual(resolveCodexInvocation({}, options), { command: executable, argsPrefix: [] });
      const status = getCodexCliAvailability({}, options);
      assert.equal(status.cliAvailable, true);
      assert.equal(status.cliPath, executable);
    });
    test(`Codex discovery reports missing ${platform} CLI with official install command`, () => {
      const status = getCodexCliAvailability({}, base);
      assert.equal(status.cliAvailable, false);
      assert.match(status.cliInstallCommand, platform === 'win32' ? /powershell.*install\.ps1/ : /curl.*install\.sh/);
      assert.match(status.cliMessage, /Settings/);
    });
    test(`Codex discovery honors explicit ${platform} overrides and does not hide errors`, () => {
      const options = fixture(platform, { [executable]: '' });
      const missing = p.join(base.home, 'missing', platform === 'win32' ? 'codex.exe' : 'codex');
      assert.equal(resolveCodexBinary({ HIKARI_CODEX_CLI: missing }, options), missing);
      assert.equal(getCodexCliAvailability({ HIKARI_CODEX_CLI: missing }, options).cliAvailable, false);
      assert.equal(resolveCodexBinary({ HIKARI_CODEX_BIN: executable }, options), executable);
    });
    test(`Codex discovery picks up a ${platform} install without cached restart state`, () => {
      assert.equal(getCodexCliAvailability({}, base).cliAvailable, false);
      assert.equal(getCodexCliAvailability({}, fixture(platform, { [executable]: '' })).cliAvailable, true);
    });
  }

  test('Windows npm launch uses Node and its JS entrypoint instead of a shell shim', () => {
    const prefix = 'C:\\Users\\Test User\\AppData\\Roaming\\npm';
    const cmd = `${prefix}\\codex.cmd`;
    const script = `${prefix}\\node_modules\\@openai\\codex\\bin\\codex.js`;
    const node = 'C:\\Program Files\\nodejs\\node.exe';
    const options = fixture('win32', {
      [`${prefix}\\codex`]: '#!/bin/sh', [cmd]: '@echo off', [script]: '#!/usr/bin/env node', [node]: ''
    });
    assert.equal(resolveCodexBinary({}, options), cmd);
    assert.deepEqual(resolveCodexInvocation({}, options), { command: node, argsPrefix: [script] });
    assert.equal(getCodexCliAvailability({}, options).cliAvailable, true);
    assert.equal(getCodexCliAvailability({}, fixture('win32', { [cmd]: '', [script]: '' })).cliAvailable, false);
  });
  test('Windows PATH lookup is case insensitive, handles quotes, and prefers exe to Unix shim', () => {
    const exe = 'D:\\My Tools\\codex.exe';
    const options = fixture('win32', { [exe]: '', 'D:\\My Tools\\codex': '#!/bin/sh' });
    const env = { Path: '"D:\\My Tools";C:\\Windows' };
    assert.equal(resolveCodexBinary(env, options), exe);
    assert.deepEqual(resolveCodexInvocation(env, options), { command: exe, argsPrefix: [] });
  });
  test('Windows bundled CLI is discovered with its exe extension', () => {
    const exe = 'C:\\Hikari\\resources\\codex.exe';
    assert.equal(resolveCodexBinary({}, { ...fixture('win32', { [exe]: '' }), resourcesPath: 'C:\\Hikari\\resources' }), exe);
  });
  test('macOS npm under nvm is discovered and launched with the matching Node', () => {
    const root = '/Users/test/.nvm/versions/node';
    const bin = `${root}/v24.1.0/bin`;
    const options = fixture('darwin', { [`${bin}/codex`]: '#!/usr/bin/env node\n', [`${bin}/node`]: '' }, { [root]: ['v22.0.0', 'v24.1.0'] });
    assert.deepEqual(resolveCodexInvocation({ PATH: '/usr/bin:/bin' }, options), { command: `${bin}/node`, argsPrefix: [`${bin}/codex`] });
  });
  test('fnm respects XDG data and explicit fnm directories without shell PATH', () => {
    for (const [env, root] of [
      [{ XDG_DATA_HOME: '/custom data' }, '/custom data/fnm/node-versions'],
      [{ FNM_DIR: '/custom fnm' }, '/custom fnm/node-versions']
    ]) {
      const bin = `${root}/v24.1.0/installation/bin`;
      const options = fixture('darwin', { [`${bin}/codex`]: '#!/usr/bin/env node\n', [`${bin}/node`]: '' }, { [root]: ['v24.1.0'] });
      assert.deepEqual(resolveCodexInvocation(env, options), { command: `${bin}/node`, argsPrefix: [`${bin}/codex`] });
    }
  });
  test('explicit JavaScript CLI entrypoints use Node even without a shebang', () => {
    const options = fixture('darwin', { '/custom/codex.js': 'console.log("fixture")', '/custom/node': '' });
    assert.deepEqual(resolveCodexInvocation({ HIKARI_CODEX_CLI: '/custom/codex.js' }, options), {
      command: '/custom/node', argsPrefix: ['/custom/codex.js']
    });
  });
  test('macOS supports both Homebrew architectures and the Codex app fallback', () => {
    for (const binary of ['/opt/homebrew/bin/codex', '/usr/local/bin/codex', '/Applications/Codex.app/Contents/Resources/codex']) {
      assert.equal(resolveCodexBinary({}, fixture('darwin', { [binary]: '' })), binary);
    }
  });
  test('custom standalone install directory is discoverable on both platforms', () => {
    for (const platform of ['darwin', 'win32']) {
      const p = platform === 'win32' ? path.win32 : path.posix;
      const directory = platform === 'win32' ? 'D:\\Tools' : '/custom/bin';
      const binary = p.join(directory, platform === 'win32' ? 'codex.exe' : 'codex');
      assert.equal(resolveCodexBinary({ CODEX_INSTALL_DIR: directory }, fixture(platform, { [binary]: '' })), binary);
    }
  });
  test('Settings status IPC preserves CLI discovery separately from saved login', async () => {
    const { registerSystemIpc } = require('../../../../src/main/ipc/register-system-ipc');
    const { LLM } = require('../../../../src/shared/ipc/channels');
    const handlers = new Map();
    const discovery = getCodexCliAvailability({}, fixture('win32'));
    registerSystemIpc({
      ipcMain: { handle: (name, handler) => handlers.set(name, handler), on() {} },
      getCodexCliWorkingDirectory: () => '',
      getCodexLoginStatus: async () => ({ ok: true, loggedIn: true, source: 'stored', ...discovery })
    });
    const status = await handlers.get(LLM.CODEX_STATUS)();
    assert.equal(status.loggedIn, true);
    for (const [key, value] of Object.entries(discovery)) assert.equal(status[key], value);
  });
  test('Settings shows and copies the install command, then restores login after detection', async () => {
    const { loadEsmStyleModule } = require('../../../support/runtime');
    let status = { ok: true, loggedIn: true, source: 'stored', ...getCodexCliAvailability({}, fixture('win32')) };
    let copied = '';
    let loginCalls = 0;
    const { createCodexAccountSettings } = loadEsmStyleModule(path.resolve(__dirname,
      '../../../../src/renderer/modules/settings/codex-account.js'), {
      window: { hikariApi: {
        getCodexLlmStatus: async () => status,
        writeTextToClipboard: async (value) => { copied = value; return { ok: true }; },
        loginCodexLlm: async () => { loginCalls++; return { ok: false }; }
      } }
    });
    const elements = Object.fromEntries([
      'settingCodexStatus', 'settingCodexAuthControls', 'settingCodexInstall',
      'settingCodexInstallCommand', 'settingCodexInstallHelp', 'copyCodexInstallCommandBtn',
      'checkCodexCliBtn', 'startCodexLoginBtn'
    ].map((name) => [name, {}]));
    const controller = createCodexAccountSettings({
      ...elements, state: { settings: {} }, persist() {},
      llmModelCatalog: { normalizeModel: () => '', normalizeReasoning: () => '' }
    });
    await controller.refreshCodexLoginStatus();
    assert.equal(elements.settingCodexInstall.hidden, false);
    assert.equal(elements.startCodexLoginBtn.disabled, true);
    assert.equal(elements.settingCodexInstallCommand.value, status.cliInstallCommand);
    assert.match(elements.settingCodexInstallHelp.textContent, /PowerShell/);
    await controller.onCopyCodexInstallCommand();
    assert.equal(copied, status.cliInstallCommand);
    await controller.onStartCodexLogin();
    await controller.onSaveLlmSettings({ preventDefault() {} });
    assert.equal(loginCalls, 0);
    status = { ...status, cliAvailable: true, loggedIn: false, source: 'none' };
    await controller.refreshCodexLoginStatus();
    assert.equal(elements.settingCodexInstall.hidden, true);
    assert.equal(elements.startCodexLoginBtn.disabled, false);
    assert.equal(elements.checkCodexCliBtn.disabled, false);
    await controller.onStartCodexLogin();
    assert.equal(loginCalls, 1);
  });
  test('Settings account actions follow stored, signed-out, and environment login states', async () => {
    const { loadEsmStyleModule } = require('../../../support/runtime');
    let status = { ok: true, loggedIn: true, source: 'stored', cliAvailable: true };
    const { createCodexAccountSettings } = loadEsmStyleModule(path.resolve(__dirname,
      '../../../../src/renderer/modules/settings/codex-account.js'), {
      window: { hikariApi: { getCodexLlmStatus: async () => status } }
    });
    const startCodexLoginBtn = {};
    const clearCodexLoginBtn = {};
    const controller = createCodexAccountSettings({
      settingCodexStatus: {}, settingCodexAuthControls: {}, startCodexLoginBtn, clearCodexLoginBtn
    });
    await controller.refreshCodexLoginStatus();
    assert.equal(startCodexLoginBtn.hidden, true);
    assert.equal(clearCodexLoginBtn.hidden, false);
    assert.equal(clearCodexLoginBtn.textContent, 'Sign out');
    status = { ...status, loggedIn: false, source: 'none' };
    await controller.refreshCodexLoginStatus();
    assert.equal(startCodexLoginBtn.hidden, false);
    assert.equal(clearCodexLoginBtn.hidden, true);
    status = { ...status, loggedIn: true, source: 'env' };
    await controller.refreshCodexLoginStatus();
    assert.equal(clearCodexLoginBtn.disabled, true);
  });
  test('Desktop setup previews the live prompt and preserves manual copy after clipboard failure', async () => {
    const { loadEsmStyleModule } = require('../../../support/runtime');
    let clipboardWorks = false;
    let copied = '';
    let generation = 0;
    const { createCodexAccountSettings } = loadEsmStyleModule(path.resolve(__dirname,
      '../../../../src/renderer/modules/settings/codex-account.js'), {
      window: { hikariApi: {
        getCodexDesktopMcpSetupPrompt: async () => ({ ok: true, prompt: `live instructions ${++generation}` }),
        writeTextToClipboard: async (text) => { copied = text; return { ok: clipboardWorks }; }
      } }
    });
    const button = {};
    const preview = { open: true, addEventListener() {} };
    const field = {};
    const status = { dataset: {} };
    const controller = createCodexAccountSettings({
      state: { settings: {} }, copyCodexDesktopMcpPromptBtn: button,
      settingCodexDesktopPreview: preview, settingCodexDesktopPrompt: field,
      settingCodexDesktopMcpStatus: status
    });
    await controller.onPreviewCodexDesktopPrompt();
    assert.equal(field.value, 'live instructions 1');
    assert.equal(copied, '');
    await controller.onCopyCodexDesktopMcpPrompt();
    assert.equal(status.dataset.state, 'error');
    assert.match(status.textContent, /copy the text manually/);
    assert.equal(field.value, 'live instructions 2');
    assert.equal(button.disabled, false);
    clipboardWorks = true;
    await controller.onCopyCodexDesktopMcpPrompt();
    assert.equal(copied, field.value);
    assert.equal(copied, 'live instructions 3');
    assert.equal(button.textContent, 'Copied');
    assert.equal(status.dataset.state, 'success');
  });
  test('Settings restores the saved model and reasoning effort into the Codex runtime on startup', async () => {
    const { loadEsmStyleModule } = require('../../../support/runtime');
    const appliedModels = [];
    const appliedReasoningEfforts = [];
    const state = {
      settings: {
        llm: {
          provider: 'codex',
          model: 'gpt-5.6-luna',
          reasoningEffort: 'high'
        }
      }
    };
    const { createCodexAccountSettings } = loadEsmStyleModule(path.resolve(__dirname,
      '../../../../src/renderer/modules/settings/codex-account.js'), {
      window: { hikariApi: {
        getCodexLlmCatalog: async () => ({
          ok: true,
          defaultModel: 'gpt-5.6-sol',
          models: [{
            id: 'gpt-5.6-luna',
            reasoningEfforts: ['low', 'medium', 'high'],
            defaultReasoningEffort: 'medium'
          }]
        }),
        setCodexLlmModel: async (model) => {
          appliedModels.push(model);
          return { ok: true, model };
        },
        setCodexLlmReasoningEffort: async (reasoningEffort) => {
          appliedReasoningEfforts.push(reasoningEffort);
          return { ok: true, reasoningEffort };
        }
      } }
    });
    let renderCount = 0;
    const llmModelCatalog = {
      setCodexCatalog() {},
      normalizeReasoning(_provider, _model, reasoningEffort) {
        return reasoningEffort;
      }
    };
    const controller = createCodexAccountSettings({
      state,
      persist() {},
      llmModelCatalog,
      renderForms() { renderCount += 1; }
    });

    await controller.refreshCodexCatalog();

    assert.deepEqual(appliedModels, ['gpt-5.6-luna']);
    assert.deepEqual(appliedReasoningEfforts, ['high']);
    assert.equal(renderCount, 1);
    assert.equal(state.settings.llm.model, 'gpt-5.6-luna');
  });
};
