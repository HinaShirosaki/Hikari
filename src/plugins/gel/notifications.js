import { createPresentation } from './i18n.mjs';
const i18nUi = createPresentation('gel');
// Gel reports through Hikari's single host-owned notice surface. Keep progress
// and empty status updates out of the transient completion/error channel.
export function createGelNotifications({ hikari, now = () => Date.now(), onError = error => console.error(error) }) {
  let lastKey = '', lastAt = 0;
  async function show(message, { kind, type } = {}) {
    const display = i18nUi.owned(message);
    const text = i18nUi.englishText(display).trim();
    const localized = i18nUi.value(display).trim();
    if (!text || kind === 'loading' || /^(?:loading|saving|preparing|checking|refreshing)\b.*(?:\.\.\.|…)$/iu.test(text)) return false;
    const failure = /(?:\b(?:error|failed|invalid|unavailable|required|cannot)\b|could not|no (?:analysis results|clear lanes)|not (?:loaded|found)|load .* before|^keep |^enter |^select a larger|^start crop mode|^drop (?:an image|image files)|^wait for|no stored image|saved preview only|disk is full|^add at least)/i.test(text);
    const noticeType = type || (kind === 'error' || kind === 'warning' || failure ? 'error' : 'success');
    const key = `${noticeType}:${text}`, timestamp = now();
    if (key === lastKey && timestamp - lastAt < 1500) return false;
    lastKey = key; lastAt = timestamp;
    try {
      await hikari.call('notifications.show', {
        message: localized.length > 1000 ? `${localized.slice(0, 999)}…` : localized,
        type: noticeType, durationMs: noticeType === 'error' ? 8000 : 5000
      });
      return true;
    } catch (error) {
      if (lastKey === key && lastAt === timestamp) lastKey = '';
      onError(error); return false;
    }
  }
  return { show };
}
