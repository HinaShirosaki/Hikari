For a 100,000+ line Electron app, do not let main.js, renderer.js, or preload.js become real application files. Treat them as tiny bootstraps only.

A good structure:

src/
  main/
    main.ts                 # app bootstrap only
    app/
      createApp.ts
      lifecycle.ts
      menu.ts
      tray.ts
      updater.ts
    windows/
      createMainWindow.ts
      windowManager.ts
      routes.ts
    ipc/
      index.ts
      channels.ts
      notebook.handlers.ts
      inventory.handlers.ts
      sequence.handlers.ts
    services/
      fileSystem.service.ts
      database.service.ts
      protocol.service.ts
      sequence.service.ts
      agent.service.ts
    security/
      permissions.ts
      csp.ts
  preload/
    preload.ts              # expose safe APIs only
    api/
      notebook.api.ts
      inventory.api.ts
      sequence.api.ts
      agent.api.ts
  renderer/
    main.tsx                # frontend bootstrap only
    app/
      App.tsx
      router.tsx
      store.ts
    modules/
      notebook/
        components/
        pages/
        hooks/
        api.ts
        types.ts
      inventory/
      protocol/
      gel/
      sequence/
      agent/
    shared/
      components/
      utils/
      types/
      constants/
  shared/
    ipcTypes.ts
    domainTypes.ts
    validators.ts
    constants.ts

Your root files should stay extremely small:

// src/main/main.ts
import { app } from 'electron';
import { createMainWindow } from './windows/createMainWindow';
import { registerIpcHandlers } from './ipc';
app.whenReady().then(() => {
  registerIpcHandlers();
  createMainWindow();
});
// src/preload/preload.ts
import { contextBridge } from 'electron';
import { notebookApi } from './api/notebook.api';
import { inventoryApi } from './api/inventory.api';
contextBridge.exposeInMainWorld('api', {
  notebook: notebookApi,
  inventory: inventoryApi,
});
// src/renderer/main.tsx
import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
createRoot(document.getElementById('root')!).render(<App />);

The key rule is:

main.ts      = Electron lifecycle, windows, IPC registration
preload.ts   = secure bridge only
renderer.tsx = frontend entry only

For your ELN/ILN app, organize by domain modules, not by file type:

modules/
  notebook/
  protocol/
  inventory/
  gel/
  assay/
  sequence/
  paper/
  agent/
  project/
  chemical/

Each module should own its UI, API wrapper, types, and local logic.

A strong pattern is:

notebook/
  components/
  pages/
  hooks/
  api.ts          # calls window.api.notebook
  types.ts
  utils.ts

In the main process:

ipc/
  notebook.handlers.ts
  protocol.handlers.ts
  inventory.handlers.ts

Example:

// main/ipc/notebook.handlers.ts
import { ipcMain } from 'electron';
import { notebookService } from '../services/notebook.service';
export function registerNotebookHandlers() {
  ipcMain.handle('notebook:create', async (_, input) => {
    return notebookService.create(input);
  });
  ipcMain.handle('notebook:list', async () => {
    return notebookService.list();
  });
}
// preload/api/notebook.api.ts
import { ipcRenderer } from 'electron';
export const notebookApi = {
  create: (input) => ipcRenderer.invoke('notebook:create', input),
  list: () => ipcRenderer.invoke('notebook:list'),
};

Then renderer never directly touches Electron:

await window.api.notebook.create(data);

For a huge app, I would recommend this principle:

Electron main process = backend shell
Renderer = frontend app
Preload = secure typed RPC bridge
Shared = types/contracts only

Do not put these in main.js:

business logic
database queries
AI agent logic
file parsing
protocol generation
sequence analysis
inventory rules
large IPC handlers

Put them in services:

services/
  notebook.service.ts
  protocol.service.ts
  sequence.service.ts
  agent.service.ts
  pdf.service.ts
  database.service.ts

For your app specifically, this architecture fits well:

main/
  services/
    notebook.service.ts
    protocol.service.ts
    inventory.service.ts
    sequence.service.ts
    gelAnalysis.service.ts
    agent.service.ts
    paper.service.ts
renderer/
  modules/
    notebook/
    protocols/
    inventory/
    sequence/
    gel/
    agent/
    papers/

Best rule of thumb:

If main.ts > 100 lines, split it.
If preload.ts > 200 lines, split APIs by module.
If an IPC file > 300 lines, split by feature.
If renderer entry contains logic, move it into App/router/store.

For your case, I would use TypeScript + feature-based modules + typed IPC contracts. That will prevent a 100,000-line Electron app from becoming impossible to debug.