const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '..');

if (!process.versions.electron) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'hikari-agent-action-icons-'));
  try {
    const result = require('node:child_process').spawnSync(require('electron'), [__filename, temp], {
      encoding: 'utf8',
      timeout: 60000
    });
    process.stdout.write(result.stdout || '');
    process.stderr.write(result.stderr || '');
    if (result.status !== 0) {
      throw result.error || new Error(`Electron check failed: ${result.status} (${result.signal || ''})`);
    }
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
} else {
  const { app, BrowserWindow } = require('electron');
  const temp = process.argv[2];
  app.setPath('userData', path.join(temp, 'profile'));

  app.whenReady().then(async () => {
    const stylesUrl = pathToFileURL(path.join(root, 'styles.css')).href;
    const fixturePath = path.join(temp, 'fixture.html');
    const artifactDir = path.join(root, 'artifacts', 'hikari-agent-action-icons');
    fs.mkdirSync(artifactDir, { recursive: true });
    fs.writeFileSync(fixturePath, `<!doctype html>
      <html>
        <head>
          <meta charset="utf-8" />
          <link rel="stylesheet" href="${stylesUrl}" />
          <style>
            body { display: block; min-height: 100vh; padding: 2rem; }
            .qa-surface { width: min(42rem, 100%); margin: 0 auto; padding: 1.5rem; border: 1px solid var(--theme-border); border-radius: 1rem; background: var(--theme-surface-elevated); }
            .qa-surface h1 { margin-top: 0; }
            .qa-grid { display: flex; flex-wrap: wrap; align-items: center; gap: 0.8rem; }
            .qa-grid #home-view, .qa-grid #home-view .home-tile { display: contents; }
          </style>
        </head>
        <body>
          <main class="qa-surface">
            <h1>Hikari model actions</h1>
            <div class="qa-grid">
              <button type="button" class="primary-btn agent-send-icon-btn" data-qa-agent-chat-send aria-label="Send message">
                <svg class="agent-send-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5"></path><path d="m6.5 10.5 5.5-5.5 5.5 5.5"></path></svg>
                <span class="sr-only">Send message</span>
              </button>
              <div id="home-view"><div class="home-tile">
                <button type="button" class="home-icon-btn home-icon-btn-send hikari-agent-action hikari-agent-action-icon" aria-label="Send experiment to Assistant"></button>
              </div></div>
              <button type="button" class="ghost-btn hikari-agent-action">Generate Protocol</button>
              <button type="button" class="ghost-btn hikari-agent-action">Polish Protocol</button>
              <button type="button" class="ghost-btn hikari-agent-action">Clarify and Save</button>
              <button type="button" class="ghost-btn hikari-agent-action">Suggest next experiment</button>
              <button type="button" class="selection-insight-menu-item hikari-agent-action">What is it</button>
            </div>
          </main>
        </body>
      </html>`);

    const win = new BrowserWindow({
      width: 900,
      height: 520,
      show: false,
      webPreferences: { contextIsolation: true, sandbox: false }
    });

    try {
      await win.loadFile(fixturePath);
      const result = await win.webContents.executeJavaScript(`(() => {
        const issues = [];
        const buttons = [...document.querySelectorAll('.hikari-agent-action')];
        const checks = buttons.map((button) => {
          const style = getComputedStyle(button, '::before');
          const rect = button.getBoundingClientRect();
          return {
            label: button.getAttribute('aria-label') || button.textContent.trim(),
            mask: style.webkitMaskImage || style.maskImage,
            background: style.backgroundImage,
            iconWidth: parseFloat(style.width),
            iconHeight: parseFloat(style.height),
            buttonWidth: rect.width,
            buttonHeight: rect.height,
            iconOnly: button.classList.contains('hikari-agent-action-icon'),
            legacyIconHidden: button.querySelector('svg') ? getComputedStyle(button.querySelector('svg')).display === 'none' : true
          };
        });
        if (!checks.length) issues.push('No model-action buttons rendered.');
        for (const check of checks) {
          if (!check.mask.includes('hikari-button.svg')) issues.push('Missing Hikari mask for ' + check.label);
          if (!check.background.includes('linear-gradient')) issues.push('Missing rainbow for ' + check.label);
          const minimumIconSize = check.iconOnly ? 25 : 22;
          if (!(check.iconWidth > minimumIconSize && check.iconHeight > minimumIconSize)) issues.push('Hikari mark is too small for ' + check.label);
          if (!(check.buttonWidth > check.iconWidth && check.buttonHeight > check.iconHeight)) issues.push('Hikari mark overflows ' + check.label);
          if (!check.legacyIconHidden) issues.push('Legacy send glyph remained visible for ' + check.label);
        }
        const agentChatSend = document.querySelector('[data-qa-agent-chat-send]');
        const agentChat = {
          arrowDisplay: getComputedStyle(agentChatSend.querySelector('svg')).display,
          pseudoContent: getComputedStyle(agentChatSend, '::before').content
        };
        if (agentChat.arrowDisplay === 'none') issues.push('Agent Chat arrow is hidden.');
        if (!['none', 'normal'].includes(agentChat.pseudoContent)) issues.push('Agent Chat send should not show the Hikari mark.');
        return { checks, agentChat, issues };
      })()`);
      if (result.issues.length) {
        throw new Error(result.issues.join(' '));
      }
      fs.writeFileSync(path.join(artifactDir, 'rainbow-actions.png'), (await win.webContents.capturePage()).toPNG());
      await win.webContents.executeJavaScript("new Promise((resolve) => { document.body.classList.add('theme-night'); setTimeout(resolve, 220); })");
      fs.writeFileSync(path.join(artifactDir, 'rainbow-actions-night.png'), (await win.webContents.capturePage()).toPNG());
      console.log(`Hikari agent action Electron QA passed: ${JSON.stringify(result)}`);
    } finally {
      win.destroy();
      app.quit();
    }
  }).catch((error) => {
    console.error(error);
    app.exit(1);
  });
}
