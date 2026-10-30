import { i18n as appI18n } from '../lib/i18n/index.js';
import { translateTree } from '../lib/i18n/dom.js';

export function createAppLocalization({ state, documentObject, windowObject = documentObject?.defaultView, translator = appI18n }) {
  translator.setLocale(state.settings?.locale);
  let nativeLocale = '';
  function refresh() {
    const locale = translator.getLocale();
    documentObject?.documentElement?.setAttribute?.('lang', locale);
    translateTree(documentObject, translator);
    if (nativeLocale !== locale && typeof windowObject?.hikariApi?.setUiLocale === 'function') {
      nativeLocale = locale;
      const failed = () => { if (nativeLocale === locale) nativeLocale = ''; };
      try {
        Promise.resolve(windowObject.hikariApi.setUiLocale(locale)).then(result => {
          if (result?.ok === false) failed();
        }, failed);
      } catch { failed(); }
    }
  }
  const disconnect = translator.subscribe(refresh);
  function sync() {
    translator.setLocale(state.settings?.locale);
    refresh();
  }
  sync();
  return { sync, disconnect };
}
