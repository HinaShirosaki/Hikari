import { setSettingsText } from './localization.js';

// Settings > Updates. The main-process updater owns the state; this panel
// renders its status and offers Check / Install.
function describe(update = {}) {
  const params = { version: update.currentVersion || '', latest: String(update.latestVersion) };
  let key;
  switch (update.status) {
    case 'checking': key = 'checking'; break;
    case 'up-to-date': key = update.currentVersion ? 'upToDateCurrent' : 'upToDate'; break;
    case 'update-available': key = update.currentVersion ? 'availableCurrent' : 'available'; break;
    case 'installing': key = update.installKind === 'app' ? 'installingApp' : 'installingSource'; break;
    case 'ready': key = 'ready'; break;
    case 'error':
      key = update.error ? 'error' : 'unknownError';
      params.error = String(update.error || '');
      break;
    case 'development-disabled': key = 'development'; break;
    case 'not-configured': key = 'unavailable'; break;
    default: return { key: update.currentVersion ? 'updates.current' : 'empty', params };
  }
  return { key: `updates.${key}`, params };
}

export function createUpdateSettings({ api, statusElement, checkButton, installButton }) {
  let busy = false;
  let last = {};

  function render(update = {}) {
    last = update;
    if (statusElement) {
      const message = describe(update);
      setSettingsText(statusElement, message.key, message.params);
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
