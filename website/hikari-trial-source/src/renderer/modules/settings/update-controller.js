// Settings > Updates. The main-process updater owns the state; this panel
// renders its status and offers Check / Install.
function describe(update = {}) {
  const current = update.currentVersion ? `You are using Hikari ${update.currentVersion}.` : '';
  switch (update.status) {
    case 'checking': return 'Checking for updates…';
    case 'up-to-date': return `Hikari is up to date. ${current}`;
    case 'update-available': return `Hikari ${update.latestVersion} is available. ${current}`;
    case 'installing': return `Downloading and installing Hikari ${update.latestVersion}. This takes ${update.installKind === 'app' ? 'under a minute' : 'a few minutes'}; you can keep working. Hikari restarts when it is done.`;
    case 'ready': return 'Restarting Hikari…';
    case 'error': return `Could not update: ${update.error || 'unknown error'}`;
    case 'development-disabled': return 'Updates are available in the installed app, not in a development run.';
    case 'not-configured': return 'Updates are not available in this build.';
    default: return current;
  }
}

export function createUpdateSettings({ api, statusElement, checkButton, installButton }) {
  let busy = false;
  let last = {};

  function render(update = {}) {
    last = update;
    if (statusElement) {
      statusElement.textContent = describe(update);
      statusElement.dataset.error = String(update.status === 'error');
    }
    const working = busy || update.status === 'installing' || update.status === 'ready';
    const unavailable = update.status === 'development-disabled' || update.status === 'not-configured';
    if (checkButton) checkButton.disabled = working || unavailable || !api?.checkForUpdates;
    if (installButton) installButton.disabled = working || update.status !== 'update-available' || !api?.installUpdate;
  }

  async function run(action, pending) {
    if (busy) return;
    busy = true;
    render(pending);
    let result;
    try {
      result = await action();
    } catch (error) {
      result = { status: 'error', error: String(error?.message || error) };
    } finally {
      busy = false;
    }
    render(result);
  }

  async function refresh() {
    if (busy || !api?.getUpdateStatus) {
      if (!api?.getUpdateStatus) render({ status: 'not-configured' });
      return;
    }
    try {
      render(await api.getUpdateStatus());
    } catch (error) {
      render({ status: 'error', error: String(error?.message || error) });
    }
  }

  checkButton?.addEventListener('click', () => {
    void run(() => api.checkForUpdates(), { status: 'checking' });
  });
  installButton?.addEventListener('click', () => {
    void run(() => api.installUpdate(), { ...last, status: 'installing' });
  });

  return { refresh };
}
