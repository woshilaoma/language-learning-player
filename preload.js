const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('native', {
  setLang: code => ipcRenderer.invoke('app:setLang', code), /* 同步主进程对话框语言 */
  chooseVideos: () => ipcRenderer.invoke('dialog:openVideos'),
  chooseSubtitle: () => ipcRenderer.invoke('dialog:openSubtitle'), /* 返回路径数组，取消为 [] */
  chooseFolder: () => ipcRenderer.invoke('dialog:openFolder'),
  readSubtitle: p => ipcRenderer.invoke('file:readSubtitle', p),
  findSubtitlesForVideo: p => ipcRenderer.invoke('file:findSubtitlesForVideo', p),
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
