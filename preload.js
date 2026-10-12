const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('native', {
  chooseVideos: () => ipcRenderer.invoke('dialog:openVideos'),
  chooseSubtitle: () => ipcRenderer.invoke('dialog:openSubtitle'),
  chooseFolder: () => ipcRenderer.invoke('dialog:openFolder'),
  readSubtitle: p => ipcRenderer.invoke('file:readSubtitle', p),
  findSubtitleForVideo: p => ipcRenderer.invoke('file:findSubtitleForVideo', p),
  whisperCli: payload => ipcRenderer.invoke('asr:whisperCli', payload),
  pathForFile: file => {
    try {
      return webUtils.getPathForFile(file);
    } catch {
      return file.path || null;
    }
  },
  getVersion: () => ipcRenderer.invoke('app:version')
});
