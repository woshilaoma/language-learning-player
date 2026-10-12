/* 语音识别：OpenAI 兼容 HTTP 接口 或 本地 whisper.cpp 命令行 */
const Asr = (function () {
  'use strict';

  async function transcribe(rec) {
    if (Settings.get('provider') === 'whispercli') return whisperCli(rec);
    return viaApi(rec);
  }

  /* OpenAI 兼容接口：POST {endpoint}/audio/transcriptions */
  async function viaApi(rec) {
    const endpoint = String(Settings.get('apiEndpoint') || '').replace(/\/+$/, '');
    const apiKey = String(Settings.get('apiKey') || '').trim();
    const model = String(Settings.get('apiModel') || '').trim() || 'whisper-1';
    const language = Settings.get('asrLanguage');

    const form = new FormData();
    form.append('file', rec.wavBlob, 'rec.wav');
    form.append('model', model);
    if (language && language !== 'auto') form.append('language', language);
    const headers = {};
    if (apiKey) headers.Authorization = 'Bearer ' + apiKey;

    let res;
    try {
      res = await fetch(endpoint + '/audio/transcriptions', {
        method: 'POST',
        headers: headers,
        body: form
      });
    } catch (err) {
      throw new Error('无法连接识别服务，请检查网络或服务地址');
    }
    if (!res.ok) {
      if (res.status === 401) throw new Error('API Key 无效或无权限');
      if (res.status === 404) throw new Error('服务地址或模型名不正确');
      throw new Error('请求失败(HTTP ' + res.status + ')');
    }
    let data = null;
    try { data = await res.json(); } catch (err) { data = null; }
    const text = data && typeof data.text === 'string' ? data.text : '';
    return text.trim();
  }

  /* 本地 whisper.cpp：走 IPC，主进程错误 message 原样透传 */
  async function whisperCli(rec) {
    let out;
    try {
      out = await window.native.whisperCli({
        exePath: Settings.get('wcExe'),
        modelPath: Settings.get('wcModel'),
        wavBase64: rec.wavBase64,
        language: Settings.get('asrLanguage')
      });
    } catch (err) {
      let msg = (err && err.message) || String(err);
      /* 去掉 Electron invoke 包装，保留主进程原始 message */
      msg = msg.replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, '');
      throw new Error(msg);
    }
    return String(out || '').trim();
  }

  return { transcribe: transcribe };
})();
