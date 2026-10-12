const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');
const iconv = require('iconv-lite');

/* 文件对话框标题的各语言文案（与渲染进程 i18n 字典同源） */
const DIALOG_TITLES = require('./renderer/js/i18n/titles.json');
let uiLang = 'en';

const SUB_EXTS = ['.srt', '.ass', '.ssa', '.vtt'];
const VIDEO_EXTS = ['.mp4', '.m4v', '.mkv', '.webm', '.mov', '.avi', '.wmv', '.ts', '.mpg', '.mpeg', '.3gp', '.ogv', '.flv'];

let win = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1380,
    height: 880,
    minWidth: 1080,
    minHeight: 640,
    backgroundColor: '#0f1115',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false
    }
  });
  win.webContents.session.setPermissionRequestHandler((_wc, permission, cb) => {
    cb(permission === 'media');
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());

/* ---------------- 字幕解码（UTF-8 / UTF-16 / GB18030 自动识别） ---------------- */

function decodeText(buf) {
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return buf.slice(3).toString('utf8');
  }
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return iconv.decode(buf, 'utf16-le');
  }
  const utf8 = buf.toString('utf8');
  if (!utf8.includes('\uFFFD')) return utf8;
  return iconv.decode(buf, 'gb18030');
}

/* ---------------- IPC ---------------- */

const VIDEO_FILTER = { name: '视频', extensions: VIDEO_EXTS.map(e => e.slice(1)) };
const SUB_FILTER = { name: '字幕', extensions: SUB_EXTS.map(e => e.slice(1)) };

/* 渲染进程启动 / 切语言时同步；titles.json 缺该语言时回退 en */
ipcMain.handle('app:setLang', (_e, code) => {
  uiLang = DIALOG_TITLES[code] ? code : 'en';
});

ipcMain.handle('dialog:openVideos', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: (DIALOG_TITLES[uiLang] || DIALOG_TITLES.en).videos,
    properties: ['openFile', 'multiSelections'],
    filters: [VIDEO_FILTER, { name: '所有文件', extensions: ['*'] }]
  });
  return r.canceled ? [] : r.filePaths;
});

ipcMain.handle('dialog:openSubtitle', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: (DIALOG_TITLES[uiLang] || DIALOG_TITLES.en).subs,
    properties: ['openFile', 'multiSelections'],
    filters: [SUB_FILTER, { name: '所有文件', extensions: ['*'] }]
  });
  return r.canceled ? [] : r.filePaths;
});

ipcMain.handle('dialog:openFolder', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: (DIALOG_TITLES[uiLang] || DIALOG_TITLES.en).folder,
    properties: ['openDirectory']
  });
  if (r.canceled || !r.filePaths.length) return [];
  const dir = r.filePaths[0];
  let names = [];
  try {
    names = await fs.promises.readdir(dir);
  } catch {
    return [];
  }
  return names
    .filter(n => VIDEO_EXTS.includes(path.extname(n).toLowerCase()))
    .sort()
    .map(n => path.join(dir, n));
});

ipcMain.handle('file:readSubtitle', async (_e, p) => {
  if (!SUB_EXTS.includes(path.extname(p).toLowerCase())) {
    throw new Error('不支持的字幕格式: ' + path.extname(p));
  }
  const buf = await fs.promises.readFile(p);
  return { path: p, name: path.basename(p), text: decodeText(buf) };
});

/* 视频同目录下的全部候选字幕：与视频同名的排最前，
   其余以视频名为前缀的按文件名长度升序排后；找不到返回 [] */
ipcMain.handle('file:findSubtitlesForVideo', async (_e, videoPath) => {
  const dir = path.dirname(videoPath);
  const base = path.basename(videoPath, path.extname(videoPath));
  let names;
  try {
    names = await fs.promises.readdir(dir);
  } catch {
    return [];
  }
  const subs = names.filter(n => SUB_EXTS.includes(path.extname(n).toLowerCase()));
  const out = [];
  const exact = subs.find(n => path.basename(n, path.extname(n)) === base);
  if (exact) out.push(path.join(dir, exact));
  const partial = subs
    .filter(n => n !== exact && path.basename(n, path.extname(n)).startsWith(base))
    .sort((a, b) => a.length - b.length);
  for (const n of partial) out.push(path.join(dir, n));
  return out;
});

/* 本地 whisper.cpp 命令行识别：写临时 wav -> whisper-cli -> 读 stdout */
ipcMain.handle('asr:whisperCli', async (_e, { exePath, modelPath, wavBase64, language }) => {
  if (!exePath || !modelPath) throw new Error('未配置 whisper.cpp 程序或模型路径');
  const tmp = path.join(os.tmpdir(), `llp-rec-${Date.now()}.wav`);
  await fs.promises.writeFile(tmp, Buffer.from(wavBase64, 'base64'));
  try {
    const args = ['-m', modelPath, '-f', tmp, '-nt', '-np', '-l', language && language !== 'auto' ? language : 'auto'];
    const { stdout } = await execFile(exePath, args, { timeout: 120000, maxBuffer: 10 * 1024 * 1024 });
    return stdout.replace(/\r/g, '').split('\n').map(l => l.trim()).filter(Boolean).join(' ');
  } finally {
    fs.promises.unlink(tmp).catch(() => {});
  }
});

ipcMain.handle('app:version', () => app.getVersion());
