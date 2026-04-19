import * as protocolManagementModule from './protocol/index.js';

export function initProtocolManagement(options) {
  return protocolManagementModule.initProtocolManagement({
    ...options,
    __globals: {
      document: typeof document !== 'undefined' ? document : null,
      windowObject: typeof window !== 'undefined' ? window : null,
      enanaApi: typeof window !== 'undefined' ? window.enanaApi : (typeof enanaApi !== 'undefined' ? enanaApi : null),
      navigator: typeof navigator !== 'undefined' ? navigator : null,
      FileReader: typeof FileReader !== 'undefined' ? FileReader : null,
      TextEncoder: typeof TextEncoder !== 'undefined' ? TextEncoder : null,
      btoa: typeof btoa !== 'undefined' ? btoa : null
    }
  });
}
