'use strict';

const { TELEGRAM, TELEGRAM_COMMAND_EVENT } = require('../../../shared/ipc/channels');

function createTelegramApi(ipcRenderer) {
  return {
    getTelegramBotConfig: () => ipcRenderer.invoke(TELEGRAM.GET_CONFIG),
    setTelegramBotToken: (token) => ipcRenderer.invoke(TELEGRAM.SET_TOKEN, { token }),
    clearTelegramBotToken: () => ipcRenderer.invoke(TELEGRAM.CLEAR_TOKEN),
    onTelegramCommand: (handler) => {
      if (typeof handler !== 'function') {
        return;
      }
      ipcRenderer.on(TELEGRAM_COMMAND_EVENT, (_event, payload) => {
        handler(payload);
      });
    }
  };
}

module.exports = {
  createTelegramApi
};
