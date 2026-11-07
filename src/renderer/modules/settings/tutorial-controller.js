import { setSettingsText } from './localization.js';

// Settings > Tutorial. The main process owns the downloaded copy
// (tutorial-download.js); this panel shows its version and offers
// Download or Open, Check for Updates, and Update.

// "2026-11-07 · 493c994": the repo commit the copy came from, dated.
const label = (version) => (version ? [String(version.date).slice(0, 10), version.commit.slice(0, 7)].filter(Boolean).join(' · ') : '');

const MESSAGES = {
  'not-downloaded': 'tutorial.notDownloaded',
  installed: 'tutorial.installed',
  checking: 'tutorial.checking',
  'up-to-date': 'tutorial.upToDate',
  'update-available': 'tutorial.available',
  downloading: 'tutorial.downloading',
  error: 'tutorial.error'
};

export function createTutorialSettings({ api, statusElement, openButton, checkButton, updateButton, onOpenError }) {
  let busy = false;
  let last = { status: 'not-downloaded' };

  function render(tutorial) {
    last = tutorial;
    const downloaded = Boolean(tutorial.installed);
    if (statusElement) {
      setSettingsText(statusElement, MESSAGES[tutorial.status] || MESSAGES.error, {
        version: label(tutorial.installed),
        latest: label(tutorial.latest),
        error: String(tutorial.error || '')
      });
      statusElement.dataset.error = String(tutorial.status === 'error');
    }
    if (openButton) {
      // Nothing to open until it is downloaded, so the main button downloads first.
      setSettingsText(openButton, downloaded ? 'tutorial.open' : 'tutorial.download');
      openButton.disabled = busy;
    }
    if (checkButton) {
      checkButton.hidden = !downloaded;
      checkButton.disabled = busy;
    }
    if (updateButton) {
      updateButton.hidden = tutorial.status !== 'update-available';
      updateButton.disabled = busy;
    }
  }

  async function run(action, pending) {
    if (busy) return;
    busy = true;
    render(pending);
    let result;
    try {
      result = await action();
    } catch (error) {
      result = { status: 'error', installed: last.installed, error: String(error?.message || error) };
    } finally {
      busy = false;
    }
    render(result);
  }

  async function refresh() {
    if (busy) return;
    if (!api?.getTutorialStatus) {
      render({ status: 'error', installed: null, error: 'The tutorial is unavailable.' });
      return;
    }
    try {
      render(await api.getTutorialStatus());
    } catch (error) {
      render({ status: 'error', installed: null, error: String(error?.message || error) });
    }
  }

  const install = () => run(() => api.installTutorial(), { ...last, status: 'downloading' });

  openButton?.addEventListener('click', async () => {
    if (!last.installed) {
      await install();
      return;
    }
    const result = await api?.openTutorial?.();
    if (result && result.ok === false) onOpenError?.(result.error);
  });
  checkButton?.addEventListener('click', () => {
    void run(() => api.checkTutorialUpdate(), { ...last, status: 'checking' });
  });
  updateButton?.addEventListener('click', () => { void install(); });

  return { refresh };
}
