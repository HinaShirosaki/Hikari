'use strict';

const { clipboard, contextBridge, ipcRenderer, nativeImage } = require('electron');
const { createPreloadApi } = require('./preload/create-preload-api');

contextBridge.exposeInMainWorld('hikariApi', createPreloadApi(ipcRenderer, { clipboard, nativeImage }));
