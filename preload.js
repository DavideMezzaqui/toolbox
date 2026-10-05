'use strict';

const { contextBridge, ipcRenderer } = require('electron');

/*
 * The File System Access API hides real paths by design, which is fine for a
 * web page but leaves a desktop tool unable to say where the folder is or open
 * it. So the folder is chosen through Electron's own dialog instead, and the
 * page works in ordinary paths from there on.
 *
 * Every call is a request to the main process, which validates it. The page
 * never gets a file handle or anything it could misuse.
 */
contextBridge.exposeInMainWorld('desktop', {
  sceneSync: {
    run: request => ipcRenderer.invoke('scene-sync:run', request),
    loadSettings: () => ipcRenderer.invoke('scene-sync:load-settings'),
    saveSettings: value => ipcRenderer.invoke('scene-sync:save-settings', value),
    suggest: (config, selected, role) => ipcRenderer.invoke('scene-sync:suggest', config, selected, role),
    project: (config, selected, role) => ipcRenderer.invoke('scene-sync:project', config, selected, role),
    pick: (kind, initial) => ipcRenderer.invoke('scene-sync:pick', kind, initial),
    profile: (action, value) => ipcRenderer.invoke('scene-sync:profile', action, value),
    openBackup: manifest => ipcRenderer.invoke('scene-sync:open-backup', manifest),
    help: mode => ipcRenderer.invoke('scene-sync:help', mode)
  },
  pickFolder:  ()             => ipcRenderer.invoke('desktop:pick-folder'),
  listFiles:   (dir)          => ipcRenderer.invoke('desktop:list-files', dir),
  renameMany:  (dir, ops)     => ipcRenderer.invoke('desktop:rename-many', dir, ops),
  openFolder:  (dir)          => ipcRenderer.invoke('desktop:open-folder', dir)
});
