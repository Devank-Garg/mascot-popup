const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mascot', {
  dismiss: () => ipcRenderer.send('dismiss'),
  moveWindow: (dx, dy) => ipcRenderer.send('move-window', { dx, dy }),
});
