import "./localization.js";
import { createPresentation } from "../../lib/i18n/presentation.js";
const i18nUi = createPresentation("settings");
function createCodexUsageSettings({ settingCodexUsage, settingCodexUsageStatus,
  refreshCodexUsageBtn, isConnected = () => false } = {}) {
  let revision = 0;
  let pending = null;

  function windowLabel(minutes) {
    if (minutes === 10080) return 'Weekly usage';
    if (minutes % 1440 === 0) return `${minutes / 1440}-day usage`;
    if (minutes % 60 === 0) return `${minutes / 60}-hour usage`;
    return `${minutes}-minute usage`;
  }

  function renderWindow(name, window, { label = name === 'fiveHour' ? '5-hour usage' : 'Weekly usage', hidden = false } = {}) {
    const row = settingCodexUsage?.querySelector(`[data-codex-usage-window="${name}"]`);
    if (!row) return;
    row.hidden = hidden;
    const caption = row.querySelector('[data-codex-usage-label]');
    if (caption) i18nUi.setOwnedText(caption, label);
    const available = typeof window?.usedPercent === 'number' && Number.isFinite(window.usedPercent);
    const percent = available ? Math.max(0, Math.min(100, window.usedPercent)) : null;
    i18nUi.setText(row.querySelector('[data-codex-usage-value]'), (available ? i18nUi.message("{p0}% used", { p0: Number(percent.toFixed(1)) }) : i18nUi.message("Unavailable")));
    const progress = row.querySelector('progress');
    i18nUi.setAttribute(progress, 'aria-label', i18nUi.owned(label));
    progress.hidden = !available;
    if (available) progress.value = percent;
    else progress.removeAttribute('value');
    const date = typeof window?.resetsAt === 'number' && window.resetsAt > 0
      ? new Date(window.resetsAt * 1000) : null;
    i18nUi.setText(row.querySelector('[data-codex-usage-reset]'), (available && date && Number.isFinite(date.getTime()) ? i18nUi.message("Resets {p0}", { p0: date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) }) : ''));
  }

  function clear(message = 'Sign in to view account usage.') {
    revision += 1;
    pending = null;
    renderWindow('fiveHour', null);
    renderWindow('weekly', null);
    if (settingCodexUsageStatus) i18nUi.setOwnedText(settingCodexUsageStatus, message);
    if (settingCodexUsage) settingCodexUsage.setAttribute('aria-busy', 'false');
    if (refreshCodexUsageBtn) refreshCodexUsageBtn.disabled = !isConnected();
  }

  function refresh() {
    if (!settingCodexUsage) return Promise.resolve();
    if (!isConnected()) {
      clear();
      return Promise.resolve();
    }
    if (pending) return pending;
    if (!window.hikariApi?.getCodexLlmUsage) {
      clear('Account usage is unavailable in this version.');
      return Promise.resolve();
    }
    const requestRevision = ++revision;
    settingCodexUsage.setAttribute('aria-busy', 'true');
    if (settingCodexUsageStatus) i18nUi.setOwnedText(settingCodexUsageStatus, i18nUi.message("Checking account usage…"));
    if (refreshCodexUsageBtn) refreshCodexUsageBtn.disabled = true;
    pending = Promise.resolve().then(async () => {
      try {
        const result = await window.hikariApi.getCodexLlmUsage();
        if (requestRevision !== revision) return;
        if (!result?.ok) {
          clear(result?.error || 'Account usage is unavailable. Try refreshing.');
          return;
        }
        const [first, second] = Array.isArray(result.windows) ? result.windows : [];
        renderWindow('fiveHour', first, first ? { label: windowLabel(first.windowDurationMins) } : {});
        renderWindow('weekly', second, second ? { label: windowLabel(second.windowDurationMins) } : { hidden: Boolean(first) });
        if (settingCodexUsageStatus) i18nUi.setOwnedText(settingCodexUsageStatus, (first ? i18nUi.message("{p0}Shared across Codex apps using this account.", { p0: result.planType ? `${result.planType} plan. ` : '' }) : i18nUi.message("Codex returned no usage windows for the connected account. Refresh or sign in again.")));
      } catch {
        if (requestRevision === revision) clear('Failed to load account usage. Try refreshing.');
      } finally {
        if (requestRevision === revision) {
          pending = null;
          settingCodexUsage.setAttribute('aria-busy', 'false');
          if (refreshCodexUsageBtn) refreshCodexUsageBtn.disabled = !isConnected();
        }
      }
    });
    return pending;
  }

  clear();
  return { clear, refresh };
}

export { createCodexUsageSettings };
