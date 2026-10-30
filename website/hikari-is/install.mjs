const INSTALL_OPTIONS = {
  macos: {
    label: 'macOS',
    shell: 'Terminal',
    enterKey: 'Return',
    terminalInstructions: 'Press Command–Space, type Terminal, and press Return.',
    command: 'curl -fsSL https://cdn.jsdelivr.net/npm/@hinashirosaki/hikari/install.sh | bash',
    openInstructions: 'Open the folder printed in Terminal. Move Hikari.app to Applications, then open Hikari.',
  },
  windows: {
    label: 'Windows',
    shell: 'PowerShell',
    enterKey: 'Enter',
    terminalInstructions: 'Press the Windows key, type PowerShell, and press Enter.',
    command: 'iwr -useb https://cdn.jsdelivr.net/npm/@hinashirosaki/hikari/install.ps1 | iex',
    openInstructions: 'Open the folder printed in PowerShell and run HikariSetup.exe. Then open Hikari from the Start menu.',
  },
};

export function detectInstallPlatform(client) {
  const userAgent = String(client.userAgent || '');
  const platform = String(client.userAgentData?.platform || client.platform || userAgent);
  // iPadOS can identify itself as a Mac; touch support distinguishes that case.
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(userAgent)
    || (/Mac/i.test(platform) && client.maxTouchPoints > 1)) return null;
  if (/^Win|\bWindows\b/i.test(platform)) return 'windows';
  if (/Mac/i.test(platform)) return 'macos';
  return null;
}

async function copyCommand(root, client, value) {
  if (client.clipboard?.writeText) {
    try { await client.clipboard.writeText(value); return true; } catch { /* Try the browser fallback. */ }
  }
  const active = root.activeElement;
  const selection = root.getSelection?.();
  const ranges = selection ? Array.from({ length: selection.rangeCount }, (_, i) => selection.getRangeAt(i).cloneRange()) : [];
  const field = root.createElement('textarea');
  field.value = value; field.readOnly = true; field.tabIndex = -1;
  field.setAttribute('aria-hidden', 'true');
  Object.assign(field.style, { position: 'fixed', left: '-9999px', top: '0' });
  root.body.append(field);
  try {
    field.select();
    return typeof root.execCommand === 'function' && root.execCommand('copy');
  } catch {
    return false;
  } finally {
    field.remove();
    active?.focus({ preventScroll: true });
    if (selection && ranges.length) {
      selection.removeAllRanges();
      for (const range of ranges) selection.addRange(range);
    }
  }
}

export function initializeInstallSection(root, client, prefix = '') {
  const el = id => root.getElementById(prefix + id);
  const controls = el('install-platforms');
  const command = el('install-command');
  const line = el('install-command-line');
  const copy = el('install-copy');
  const copyLabel = el('install-copy-label');
  const copyStatus = el('install-copy-status');
  const shell = el('install-shell');
  const waitInstructions = el('install-wait-instructions');
  const terminalInstructions = el('install-terminal-instructions');
  const defaultTerminalInstructions = terminalInstructions?.textContent;
  const guide = el('install-dialog');
  const guideOpen = el('install-guide-open');
  const guideClose = el('install-guide-close');
  const openInstructions = el('install-open-instructions');
  const defaultOpenInstructions = openInstructions.textContent;
  const buttons = controls.querySelectorAll('[data-install-platform]');
  let selectedOption = null, copyAttempt = 0, resetTimer;

  function resetCopyFeedback() {
    clearTimeout(resetTimer);
    copyLabel.textContent = 'Copy'; copy.dataset.copied = 'false';
    copyStatus.textContent = '';
    copy.title = copy.getAttribute('aria-label');
  }

  function selectPlatform(platform) {
    const option = INSTALL_OPTIONS[platform];
    selectedOption = option;
    copyAttempt++;
    copy.setAttribute('aria-busy', 'false');
    resetCopyFeedback();
    for (const button of buttons) {
      button.setAttribute('aria-pressed', String(button.dataset.installPlatform === platform));
    }
    command.hidden = !option;
    line.hidden = !option; copy.hidden = !option;
    openInstructions.textContent = option?.openInstructions || defaultOpenInstructions;
    if (terminalInstructions) terminalInstructions.textContent = option?.terminalInstructions || defaultTerminalInstructions;
    if (waitInstructions) {
      waitInstructions.textContent = `Keep ${option?.shell || 'the terminal window'} open until the command finishes.`;
    }
    if (option) {
      command.textContent = option.command;
      command.setAttribute('aria-label', `${option.label} install command`);
      shell.textContent = `${option.label} · Open ${option.shell}, paste the command below, then press ${option.enterKey}.`;
      copy.setAttribute('aria-label', `Copy ${option.label} install command`);
      copy.title = `Copy ${option.label} install command`;
    } else {
      shell.textContent = 'Hikari runs on macOS and Windows. Choose a platform.';
    }
  }

  copy.addEventListener('click', async () => {
    if (!selectedOption || copy.getAttribute('aria-busy') === 'true') return;
    const option = selectedOption, attempt = ++copyAttempt;
    resetCopyFeedback(); copy.setAttribute('aria-busy', 'true');
    const success = await copyCommand(root, client, command.textContent);
    // Switching platforms during a pending copy must not mark the new command copied.
    if (attempt !== copyAttempt) return;
    copy.setAttribute('aria-busy', 'false');
    copy.dataset.copied = String(success);
    copyLabel.textContent = success ? 'Copied' : 'Retry';
    copyStatus.textContent = success
      ? `${option.label} install command copied to clipboard.`
      : 'Could not copy the command. Select it and copy it manually.';
    if (!success) copy.title = 'Copy failed. Try again.';
    resetTimer = setTimeout(resetCopyFeedback, 2500);
  });

  for (const button of buttons) {
    button.addEventListener('click', () => selectPlatform(button.dataset.installPlatform));
  }
  if (guide && guideOpen && guideClose && typeof guide.showModal === 'function') {
    guideOpen.hidden = false;
    guideOpen.addEventListener('click', () => guide.showModal());
    guideClose.addEventListener('click', () => guide.close());
    guide.addEventListener('click', (event) => {
      if (event.target !== guide) return;
      const rect = guide.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) guide.close();
    });
  } else if (guideOpen) {
    guideOpen.hidden = false;
    guideOpen.addEventListener('click', () => { root.defaultView.location.href = 'https://github.com/HinaShirosaki/Hikari/blob/main/docs/guide/README.md#install'; });
  }
  selectPlatform(detectInstallPlatform(client));
  controls.hidden = false;
  const track = controls.closest('.install-track');
  const stage = track?.querySelector('.install-stage');
  if (stage) {
    // A tall footer scrolls into view first, then holds with its bottom visible.
    // ResizeObserver also handles the previously hidden Agent tab and platform wrapping.
    new ResizeObserver(() => {
      const height = stage.offsetHeight;
      if (!height) return;
      const value = `${height}px`;
      if (track.style.getPropertyValue('--install-height') !== value) track.style.setProperty('--install-height', value);
      track.dataset.installReady = '';
    }).observe(stage);
  }
}

if (typeof document !== 'undefined') {
  initializeInstallSection(document, navigator);
  initializeInstallSection(document, navigator, 'agent-');
}
