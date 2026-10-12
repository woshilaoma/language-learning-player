/* 整句翻译与点词查词：免费通道（MyMemory + 有道词典）或 OpenAI 兼容 chat 接口；
   附字幕点词查词弹窗（发音、外部点击关闭、Esc 关闭） */
const Translate = (function () {
  'use strict';

  const cache = new Map();  /* 's:'+句子 → 译文；'w:'+词 → 查词结果 */
  let currentContext = '';  /* 当前字幕原句，查词时作上下文（app 在 onCueChange 里更新） */

  /* chat 提示词里的目标语言名（英文拼写即可，模型按语言码识别） */
  const TARGET_NAMES = { 'zh-CN': 'Chinese', 'en': 'English', 'ja': 'Japanese', 'ko': 'Korean' };
  const TTS_LANGS = { 'zh-CN': 'zh-CN', 'ja': 'ja-JP', 'ko': 'ko-KR', 'ru': 'ru-RU', 'en': 'en-US' };

  /* 语言检测：假名 → ja、谚文 → ko、汉字 → zh-CN、西里尔 → ru，否则 en */
  function detectLang(text) {
    const s = String(text || '');
    if (/[\u3040-\u30ff]/.test(s)) return 'ja';
    if (/[\uac00-\ud7af]/.test(s)) return 'ko';
    if (/[\u4e00-\u9fff]/.test(s)) return 'zh-CN';
    if (/[\u0400-\u04ff]/.test(s)) return 'ru';
    return 'en';
  }

  /* 译入语言；与来源语言相同时换一个（中↔英） */
  function pickTarget(src) {
    let tgt = Settings.get('transTarget') || 'zh-CN';
    if (src === tgt) tgt = tgt === 'zh-CN' ? 'en' : 'zh-CN';
    return tgt;
  }

  /* OpenAI 兼容 chat 接口（复用语音识别的 apiEndpoint / apiKey / transModel） */
  async function chat(prompt) {
    const endpoint = String(Settings.get('apiEndpoint') || '').replace(/\/+$/, '');
    const apiKey = String(Settings.get('apiKey') || '').trim();
    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) headers.Authorization = 'Bearer ' + apiKey;
    let res;
    try {
      res = await fetch(endpoint + '/chat/completions', {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({
          model: Settings.get('transModel') || 'gpt-4o-mini',
          temperature: 0,
          messages: [{ role: 'user', content: prompt }]
        })
      });
    } catch (err) {
      throw new Error(I18N.t('err.transNetworkApi'));
    }
    if (!res.ok) {
      if (res.status === 401) throw new Error(I18N.t('err.key401'));
      if (res.status === 404) throw new Error(I18N.t('err.key404'));
      throw new Error(I18N.t('err.transHttp', { code: res.status }));
    }
    let data = null;
    try { data = await res.json(); } catch (err) { data = null; }
    const msg = data && data.choices && data.choices[0] && data.choices[0].message;
    return String((msg && msg.content) || '').trim();
  }

  /* ---------- 整句翻译 ---------- */

  async function viaMyMemory(text) {
    const src = detectLang(text);
    const tgt = pickTarget(src);
    let res;
    try {
      res = await fetch('https://api.mymemory.translated.net/get?q=' +
        encodeURIComponent(text.slice(0, 480)) +
        '&langpair=' + encodeURIComponent(src + '|' + tgt));
    } catch (err) {
      throw new Error(I18N.t('err.transNetwork'));
    }
    let json = null;
    try { json = await res.json(); } catch (err) { json = null; }
    if (!json || !json.responseData) throw new Error(I18N.t('err.transBad', { msg: I18N.t('err.unknown') }));
    if (Number(json.responseStatus) !== 200) {
      throw new Error(I18N.t('err.transBad', { msg: json.responseDetails || json.responseStatus }));
    }
    return String(json.responseData.translatedText || '').trim();
  }

  function sentenceKey(text) {
    return 's:' + String(text || '').trim();
  }

  async function sentence(text) {
    text = String(text || '').trim();
    if (!text) return '';
    const key = sentenceKey(text);
    if (cache.has(key)) return cache.get(key);
    let out;
    if (Settings.get('transProvider') === 'api') {
      const tgt = pickTarget(detectLang(text));
      out = await chat('Translate into ' + (TARGET_NAMES[tgt] || 'Chinese') + '(' + tgt +
        '). Reply with ONLY the translation, no quotes:\n' + text);
    } else {
      out = await viaMyMemory(text);
    }
    out = String(out || '').trim();
    cache.set(key, out);
    return out;
  }

  /* 返回已缓存的译文（未翻译过则 null），不发请求 */
  function cachedSentence(text) {
    const key = sentenceKey(text);
    return cache.has(key) ? cache.get(key) : null;
  }

  /* ---------- 查词 ---------- */

  /* 有道 jsonapi 响应 → 多行文本。三级降级：
     ① ec.word[0]（ukphone 音标 + trs 释义）→ ② simple.word[0].explains
     → ③ web_trans['web-translation'] 前 2 项；全部为空 → 未查到释义 */
  function parseYoudao(json, word) {
    let phone = '';
    const means = [];
    const collect = function (arr) {
      (arr || []).forEach(function (m) {
        if (typeof m === 'string' && m.trim()) means.push(m.trim());
      });
    };
    const ecWord = json && json.ec && Array.isArray(json.ec.word) ? json.ec.word[0] : null;
    if (ecWord) {
      if (ecWord.ukphone) phone = String(ecWord.ukphone);
      (ecWord.trs || []).forEach(function (t) {
        const trs = t && Array.isArray(t.tr) ? t.tr : [];
        trs.forEach(function (x) {
          collect(x && x.l ? x.l.i : null);
        });
      });
    }
    if (!means.length) {
      const sw = json && json.simple && Array.isArray(json.simple.word) ? json.simple.word[0] : null;
      if (sw) collect(sw.explains);
    }
    if (!means.length) {
      const web = json && json.web_trans && Array.isArray(json.web_trans['web-translation'])
        ? json.web_trans['web-translation'] : [];
      web.slice(0, 2).forEach(function (w) {
        const v = w && Array.isArray(w.trans) && w.trans[0] ? w.trans[0].value : '';
        if (typeof v === 'string' && v.trim()) means.push(v.trim());
      });
    }
    if (!means.length) return I18N.t('err.noDef');
    const lines = [phone ? word + ' [' + phone + ']' : word];
    means.slice(0, 4).forEach(function (m) {
      lines.push(m.length > 60 ? m.slice(0, 60) + '…' : m);
    });
    return lines.join('\n');
  }

  async function lookupWord(word, context) {
    word = String(word || '').trim();
    if (!word) return '';
    const key = 'w:' + word.toLowerCase();
    if (cache.has(key)) return cache.get(key);
    let out;
    if (Settings.get('transProvider') === 'api') {
      const tgt = Settings.get('transTarget') || 'zh-CN';
      out = await chat('You are a dictionary. For the word/phrase "' + word + '" (context: "' +
        (context || '') + '"), reply within 3 short lines: pronunciation (IPA or pinyin), part of speech, meanings in ' +
        (TARGET_NAMES[tgt] || 'Chinese') + '. No preamble.');
    } else {
      let res;
      try {
        res = await fetch('https://dict.youdao.com/jsonapi?q=' + encodeURIComponent(word));
      } catch (err) {
        throw new Error(I18N.t('err.youdaoNetwork'));
      }
      if (!res.ok) throw new Error(I18N.t('err.youdaoHttp', { code: res.status }));
      let json = null;
      try { json = await res.json(); } catch (err) { json = null; }
      out = parseYoudao(json, word);
    }
    out = String(out || '').trim();
    cache.set(key, out);
    return out;
  }

  /* ---------- 查词弹窗（挂在 videoWrap 内，全屏时同样显示） ---------- */

  let popX = 0;  /* 最近一次弹窗锚点（相对 videoWrap），内容撑高后重新定位用 */
  let popY = 0;

  /* 按当前尺寸把弹窗放到锚点上方（字幕在视频底部，向上弹不会超出容器被裁剪）；
     上方放不下则改到锚点下方；始终夹在 videoWrap 内（8px 边距） */
  function placePopup() {
    const pop = document.getElementById('wordPopup');
    const wrap = document.getElementById('videoWrap');
    if (!pop || !wrap) return;
    const pw = pop.offsetWidth;
    const ph = pop.offsetHeight;
    const W = wrap.clientWidth;
    const H = wrap.clientHeight;
    let top = popY - ph - 12;
    if (top < 8) top = popY + 14;
    top = clamp(top, 8, Math.max(8, H - ph - 8));
    const left = clamp(popX - 10, 8, Math.max(8, W - pw - 8));
    pop.style.left = Math.round(left) + 'px';
    pop.style.top = Math.round(top) + 'px';
  }

  function showWordPopup(word, x, y) {
    const pop = document.getElementById('wordPopup');
    if (!pop) return;
    popX = x;
    popY = y;
    pop.classList.remove('hidden');
    document.getElementById('wpWord').textContent = word;
    document.getElementById('wpBody').textContent = I18N.t('toast.translating');
    placePopup();
    /* 异步查词（context 为当前字幕原句） */
    (async function () {
      try {
        const r = await lookupWord(word, currentContext);
        const body = document.getElementById('wpBody');
        if (body) {
          body.textContent = r || I18N.t('err.noDef');
          placePopup(); /* 内容撑高弹窗后重新定位，防止被容器裁剪 */
        }
      } catch (err) {
        const body = document.getElementById('wpBody');
        if (body) body.textContent = I18N.t('err.queryFail', { msg: err && err.message ? err.message : I18N.t('err.unknown') });
      }
    })();
  }

  function hideWordPopup() {
    const pop = document.getElementById('wordPopup');
    if (pop) pop.classList.add('hidden');
  }

  /* 弹窗事件（元素静态存在于 index.html，脚本在 body 末尾加载，直接绑定） */
  function bindPopupEvents() {
    const speakBtn = document.getElementById('wpSpeak');
    const closeBtn = document.getElementById('wpClose');
    if (speakBtn) {
      speakBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        const w = document.getElementById('wpWord').textContent;
        if (!w) return;
        try {
          speechSynthesis.cancel();
          const u = new SpeechSynthesisUtterance(w);
          u.lang = TTS_LANGS[detectLang(w)] || 'en-US';
          speechSynthesis.speak(u);
        } catch (err) { /* 语音合成不可用时忽略 */ }
      });
    }
    if (closeBtn) {
      closeBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        hideWordPopup();
      });
    }
    /* 点击 popup 外部（且不在字幕区内）关闭 */
    document.addEventListener('click', function (e) {
      const pop = document.getElementById('wordPopup');
      if (!pop || pop.classList.contains('hidden')) return;
      if (pop.contains(e.target)) return;
      if (e.target && e.target.closest && e.target.closest('#subtitleOverlay')) return;
      hideWordPopup();
    });
    /* Esc 关闭（不 preventDefault，不影响其它按键） */
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      const pop = document.getElementById('wordPopup');
      if (pop && !pop.classList.contains('hidden')) hideWordPopup();
    });
  }

  if (typeof document !== 'undefined') bindPopupEvents();

  return {
    detectLang: detectLang,
    sentence: sentence,
    cachedSentence: cachedSentence,
    word: lookupWord,
    setCurrentContext: function (text) { currentContext = String(text || ''); },
    showWordPopup: showWordPopup,
    hideWordPopup: hideWordPopup,
    _parseYoudao: parseYoudao
  };
})();

/* Node 单测支持（浏览器中不执行，无副作用） */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = Translate;
}
