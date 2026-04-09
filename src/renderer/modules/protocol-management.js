import * as protocolManagementModule from './protocol/index.js';

export function initProtocolManagement(options) {
  return protocolManagementModule.initProtocolManagement({
    ...options,
    __globals: {
      document: typeof document !== 'undefined' ? document : null,
      navigator: typeof navigator !== 'undefined' ? navigator : null,
      FileReader: typeof FileReader !== 'undefined' ? FileReader : null,
      TextEncoder: typeof TextEncoder !== 'undefined' ? TextEncoder : null,
      btoa: typeof btoa !== 'undefined' ? btoa : null
    }
  });
}
