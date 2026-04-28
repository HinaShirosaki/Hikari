'use strict';

const { contextBridge, ipcRenderer } = require('electron');
const { createPreloadApi } = require('./preload/create-preload-api');

contextBridge.exposeInMainWorld('enanaApi', createPreloadApi(ipcRenderer));
