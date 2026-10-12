/* 应用入口：全部 UI 接线（DOM 就绪后启动） */
document.addEventListener('DOMContentLoaded', function () {
  'use strict';

  const VIDEO_EXTS = ['.mp4', '.m4v', '.mkv', '.webm', '.mov', '.avi', '.wmv', '.ts', '.mpg', '.mpeg', '.3gp', '.ogv', '.flv'];
  const SUB_EXTS = ['.srt', '.ass', '.ssa', '.vtt'];
  const HISTORY_KEY = 'llp.shadowHistory';
  const PROGRESS_KEY = 'llp.progress';       /* 播放进度：{ [videoPath]: { t, d, at } } */
  const PLSTATE_KEY = 'llp.playlistState';   /* 播放列表状态：{ paths: [], current: n } */
  const BINDING_KEY = 'llp.subBinding';      /* 视频-字幕绑定：{ [videoPath]: [subPath, ...最多2个] } */
  const SUB_MODE_LABELS = { both: '双语', primary: '原文', secondary: '译文' };

  const video = $('#video');
  const subtitleOverlay = $('#subtitleOverlay');
  const subPage = $('.page[data-page="subs"]');

  let seeking = false;
  let lastCue = null;        /* 最近一条字幕，跟读参考用 */
  let lastDisp = null;       /* 最近一次字幕显示 { primary, secondary, cue }，整句翻译用 */
  let transHidden = false;   /* 当前句的译文被手动收起（切换句子后自动重置） */
  let recTimer = null;
  let recStart = 0;
  let lastVoiceBlob = null;  /* 最近一次跟读录音，供「播放我的录音」 */
  let lastSave = 0;          /* 上次进度保存时间（onTime 节流用） */

  /* ================= 通用 UI 辅助 ================= */

  function switchTab(name) {
    $$('#tabs .tab').forEach(function (b) {
      b.classList.toggle('active', b.dataset.tab === name);
    });
    $$('.page').forEach(function (p) {
      p.classList.toggle('active', p.dataset.page === name);
    });
  }

  /* 字幕相关按钮与当前显示模式同步：
     - 「字幕」按钮：非 off 即点亮
     - 「语言」按钮：显示当前（off 时显示上次）模式的标签，双语模式点亮 */
  function subUiSync() {
    $('#btnToggleSub').classList.toggle('active', Player.subMode !== 'off');
    const shown = Player.subMode !== 'off' ? Player.subMode : (Player.lastSubMode || 'both');
    $('#btnSubLang').textContent = SUB_MODE_LABELS[shown] || '双语';
    $('#btnSubLang').classList.toggle('active', shown === 'both');
  }

  function handleToggleSub() {
    Player.toggleSub();
    subUiSync();
  }

  function handleCycleSubLang() {
    const m = Player.cycleSubLang();
    if (m === null) {
      toast('当前字幕只有一种语言');
      return;
    }
    subUiSync();
    toast('字幕：' + (SUB_MODE_LABELS[m] || m));
  }

  function syncVolumeUi() {
    const v = Math.round(video.volume * 100);
    $('#volBar').value = v;
    $('#volLabel').textContent = v;
    $('#btnMute').textContent = (video.muted || v === 0) ? '🔇' : '🔊';
  }

  function updateSpeedLabel() {
    $('#speedLabel').textContent = (+video.playbackRate.toFixed(2)) + 'x';
  }

  function syncLoopBtn() {
    $('#btnLoopCue').classList.toggle('active', Player.loopCue);
  }

  function changeVolume(d) {
    Player.setVolume(Math.round(video.volume * 100) + d);
    syncVolumeUi();
  }

  /* ================= 列表渲染 ================= */

  function renderPlaylist() {
    const parts = [];
    for (let i = 0; i < Playlist.items.length; i++) {
      const it = Playlist.items[i];
      parts.push('<li class="p-item' + (i === Playlist.current ? ' active' : '') + '" data-index="' + i + '">' +
        '<span class="idx">' + (i + 1) + '</span>' +
        '<span class="nm">' + escHtml(it.name) + '</span>' +
        '<button class="del" type="button" title="移除">✕</button></li>');
    }
    $('#playlist').innerHTML = parts.join('');
  }

  function highlightSubItem(index) {
    $$('#subList .s-item').forEach(function (el) {
      const on = Number(el.dataset.index) === index;
      el.classList.toggle('active', on);
      if (on && subPage.classList.contains('active')) el.scrollIntoView({ block: 'nearest' });
    });
  }

  /* 某句主字幕对应的译文：cue.secondary 为空且存在第二字幕轨时，
     按第二轨时间轴在该句开始时刻找覆盖的译文 */
  function secondaryTextOf(cue) {
    if (cue.secondary) return cue.secondary;
    if (!Player.secondaryCues || !Player.secondaryCues.length) return '';
    const si = Subtitles.findCueVisibleIndex(Player.secondaryCues, cue.start + 0.01);
    if (si < 0) return '';
    const c = Player.secondaryCues[si];
    return (c.primary != null ? c.primary : c.text) || '';
  }

  function renderSubList() {
    const cues = Player.cues || [];
    const q = ($('#subFilter').value || '').trim().toLowerCase();
    const parts = [];
    for (let i = 0; i < cues.length; i++) {
      const c = cues[i];
      const primary = (c.primary != null ? c.primary : c.text) || '';
      const secondary = secondaryTextOf(c);
      if (q && primary.toLowerCase().indexOf(q) === -1 && secondary.toLowerCase().indexOf(q) === -1) continue;
      const text = secondary ? primary + '\n' + secondary : primary;
      parts.push('<div class="s-item" data-index="' + i + '">' +
        '<div class="s-time">' + fmtTime(c.start) + ' → ' + fmtTime(c.end) + '</div>' +
        '<div class="s-text">' + escHtml(text) + '</div></div>');
    }
    $('#subList').innerHTML = parts.join('');
    $('#subCount').textContent = cues.length ? '共 ' + parts.length + ' 句' : '未加载字幕';
    highlightSubItem(Player.cueIndex);
  }

  function renderHistory() {
    const hist = store.get(HISTORY_KEY) || [];
    const parts = hist.map(function (h) {
      let cls = '';
      if (typeof h.score === 'number') {
        cls = h.score >= 80 ? 'good' : (h.score >= 60 ? 'mid' : 'bad');
      }
      const txt = h.ref || h.hyp || '';
      const short = txt.length > 50 ? txt.slice(0, 50) + '…' : txt;
      return '<li><span class="h-score ' + cls + '">' + (typeof h.score === 'number' ? h.score : '--') + '</span>' +
        '<span class="h-text">' + escHtml(short) + '</span>' +
        '<span class="h-time">' + escHtml(h.at || '') + '</span></li>';
    });
    $('#historyList').innerHTML = parts.join('');
  }

  /* ================= 字幕加载 ================= */

  function extOf(p) {
    const s = String(p);
    const i = s.lastIndexOf('.');
    return i === -1 ? '' : s.slice(i).toLowerCase();
  }

  /* 加载 1-2 个字幕文件：
     - 2 个：非 cjk 的作主字幕（原文）、cjk 的作译文轨（各自时间轴合并同屏）；
             两个都非 cjk 或都 cjk 时按传入顺序前者为主
     - 1 个：解析后跑 analyzeBilingual 自动拆分「一句两行」的原文/译文
     opts.expectPath：快速切台守卫 —— 传入播放项路径，字幕就绪后若当前播放项
     已不是该路径则放弃应用（返回 false）。成功返回 true。
     成功后把「当前播放视频 → 实际读取的字幕路径」写入绑定（opts.silent 可跳过）。 */
  async function loadSubtitleFiles(paths, opts) {
    if (!paths || !paths.length) return false;
    const expectPath = opts && opts.expectPath ? opts.expectPath : null;
    const isStale = function () {
      return !!expectPath &&
        !(Playlist.items[Playlist.current] && Playlist.items[Playlist.current].path === expectPath);
    };
    const bindIfPossible = function (subPaths) {
      const cur = Playlist.items[Playlist.current];
      if (!cur || (opts && opts.silent)) return;
      saveBinding(cur.path, subPaths);
    };
    if (paths.length > 2) {
      toast('已忽略多余的字幕文件');
      paths = paths.slice(0, 2);
    }
    try {
      if (paths.length === 2) {
        const subs = await Promise.all(paths.map(function (p) { return window.native.readSubtitle(p); }));
        const ka = Subtitles.dominantScript(subs[0].text);
        const kb = Subtitles.dominantScript(subs[1].text);
        let main, sec;
        if (ka !== 'cjk' && kb === 'cjk') {
          main = subs[0]; sec = subs[1];
        } else if (kb !== 'cjk' && ka === 'cjk') {
          main = subs[1]; sec = subs[0];
        } else {
          main = subs[0]; sec = subs[1];
        }
        const cuesP = Subtitles.parse(main.text, extOf(main.path));
        const cuesS = Subtitles.parse(sec.text, extOf(sec.path));
        Subtitles.analyzeBilingual(cuesP);
        if (isStale()) return false;
        Player.setCues(cuesP, cuesS);
        renderSubList();
        switchTab('subs');
        toast('已加载双语字幕：' + subs[0].name + ' + ' + subs[1].name);
        bindIfPossible([subs[0].path, subs[1].path]);
        return true;
      }
      const sub = await window.native.readSubtitle(paths[0]);
      const cues = Subtitles.parse(sub.text, extOf(paths[0]));
      const info = Subtitles.analyzeBilingual(cues);
      if (isStale()) return false;
      Player.setCues(cues);
      renderSubList();
      switchTab('subs');
      toast(info.bilingual ? '已加载双语字幕：' + sub.name : '已加载字幕：' + sub.name);
      bindIfPossible([sub.path]);
      return true;
    } catch (err) {
      toast('加载字幕失败：' + (err && err.message ? err.message : '未知错误'));
      return false;
    }
  }

  /* ================= 进度记忆 / 字幕绑定 ================= */

  /* 存储对象按值降序只保留最近 limit 条 */
  function capObject(obj, limit, sortValue) {
    const keys = Object.keys(obj);
    if (keys.length <= limit) return obj;
    keys.sort(function (a, b) { return sortValue(obj[b]) - sortValue(obj[a]); });
    const out = {};
    for (let i = 0; i < limit; i++) out[keys[i]] = obj[keys[i]];
    return out;
  }

  /* 立即保存当前视频播放进度 */
  function saveProgressNow() {
    const it = Playlist.items[Playlist.current];
    if (!it || !video.currentSrc) return;
    const t = video.currentTime;
    if (!isFinite(t) || t <= 0) return;
    const prog = store.get(PROGRESS_KEY) || {};
    prog[it.path] = { t: t, d: isFinite(video.duration) ? video.duration : 0, at: Date.now() };
    store.set(PROGRESS_KEY, capObject(prog, 300, function (e) { return e.at || 0; }));
  }

  function removeProgress(path) {
    const prog = store.get(PROGRESS_KEY) || {};
    if (!(path in prog)) return;
    delete prog[path];
    store.set(PROGRESS_KEY, prog);
  }

  /* 播放列表持久化（onChange / onPlay 时写） */
  function savePlaylistState() {
    store.set(PLSTATE_KEY, {
      paths: Playlist.items.map(function (i) { return i.path; }),
      current: Playlist.current
    });
  }

  /* 视频-字幕绑定：删除再加使最近绑定排在末尾；超 300 条丢最旧 */
  function saveBinding(videoPath, subPaths) {
    const binding = store.get(BINDING_KEY) || {};
    delete binding[videoPath];
    binding[videoPath] = subPaths.slice(0, 2);
    const keys = Object.keys(binding);
    if (keys.length > 300) {
      const keep = {};
      for (let i = keys.length - 300; i < keys.length; i++) keep[keys[i]] = binding[keys[i]];
      store.set(BINDING_KEY, keep);
      return;
    }
    store.set(BINDING_KEY, binding);
  }

  function removeBinding(videoPath) {
    const binding = store.get(BINDING_KEY) || {};
    if (!(videoPath in binding)) return;
    delete binding[videoPath];
    store.set(BINDING_KEY, binding);
  }

  /* ================= 字幕 overlay 与翻译 ================= */

  /* 主字幕文本 → 可点击词 HTML：拉丁词 [A-Za-z\u00C0-\u024F']+ 为一个词，
     CJK（汉字/假名/谚文）单字各成一个词，其余段原样；换行 → <br> */
  function wordify(text) {
    const s = String(text || '');
    const re = /[A-Za-z\u00C0-\u024F']+|[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/g;
    let html = '';
    let last = 0;
    let m;
    while ((m = re.exec(s)) !== null) {
      if (m.index > last) html += escHtml(s.slice(last, m.index));
      html += '<span class="w" data-w="' + escHtml(m[0].toLowerCase()) + '">' + escHtml(m[0]) + '</span>';
      last = m.index + m[0].length;
    }
    html += escHtml(s.slice(last));
    return html.replace(/\n/g, '<br>');
  }

  /* 渲染字幕 overlay：主行词可点击、次行原样、已缓存译文自动带出、右上角整句翻译按钮 */
  function renderOverlay(disp) {
    if (!disp || !disp.cue || !disp.primary || Player.subMode === 'off') {
      subtitleOverlay.innerHTML = '';
      Translate.hideWordPopup();
      return;
    }
    /* 译文模式但字幕没有译文时，兜底显示原文 */
    const showPrimary = Player.subMode !== 'secondary' || !Player.hasSecondary();
    const showSecondary = Player.subMode !== 'primary' && !!disp.secondary;
    let html = '';
    if (showPrimary) html += '<div class="sub-p">' + wordify(disp.primary) + '</div>';
    if (showSecondary) html += '<div class="sub-s">' + escHtml(disp.secondary) + '</div>';
    const cached = !transHidden && Translate.cachedSentence(disp.primary);
    if (cached) html += '<div class="sub-t">' + escHtml(cached) + '</div>';
    html += '<button class="sub-tr' + (cached ? ' active' : '') + '" title="整句翻译（T），再按一次收起/展开">译</button>';
    subtitleOverlay.innerHTML = html;
  }

  /* 整句翻译当前字幕（「译」按钮 / T 键） */
  async function translateCurrentSentence() {
    if (!lastDisp || !lastDisp.primary) {
      toast('当前没有字幕');
      return;
    }
    const text = lastDisp.primary;
    /* 已有译文：再按一次收起；已收起：展开（缓存即时） */
    if (Translate.cachedSentence(text)) {
      transHidden = !transHidden;
      renderOverlay(lastDisp);
      return;
    }
    let box = null;
    /* 字幕可见时先在 overlay 上显示「翻译中…」（复用或新建 .sub-t） */
    if (Player.subMode !== 'off' && subtitleOverlay.innerHTML !== '') {
      box = subtitleOverlay.querySelector('.sub-t');
      if (!box) {
        box = document.createElement('div');
        box.className = 'sub-t';
        subtitleOverlay.appendChild(box);
      }
      box.textContent = '翻译中…';
    }
    try {
      await Translate.sentence(text);
      transHidden = false;
      renderOverlay(lastDisp); /* 缓存已写入，重渲染自动带出译文 */
    } catch (err) {
      if (box && box.parentNode) box.remove();
      toast('翻译失败：' + (err && err.message ? err.message : '未知错误'));
    }
  }

  /* ================= 跟读流程 ================= */

  function stopRecUi() {
    if (recTimer) { clearInterval(recTimer); recTimer = null; }
    $('#recIndicator').classList.remove('show');
    $('#btnRecord').classList.remove('recording');
    const b2 = $('#btnRecord2');
    b2.classList.remove('recording');
    b2.textContent = '🎙 开始录音（R）';
  }

  async function toggleRecord() {
    if (Recorder.state !== 'recording') {
      if (!video.currentSrc) { toast('请先打开视频'); return; }
      try {
        recStart = Date.now();
        await Recorder.start();
      } catch (err) {
        toast(err && err.message ? err.message : '无法访问麦克风');
        return;
      }
      $('#recTime').textContent = '0.0s';
      $('#recIndicator').classList.add('show');
      $('#btnRecord').classList.add('recording');
      const b2 = $('#btnRecord2');
      b2.classList.add('recording');
      b2.textContent = '⏹ 停止录音';
      recTimer = setInterval(function () {
        $('#recTime').textContent = ((Date.now() - recStart) / 1000).toFixed(1) + 's';
      }, 100);
      return;
    }
    stopRecUi();
    const res = await Recorder.stop();
    if (!res || !res.ok) { toast('录音太短'); return; }
    lastVoiceBlob = res.wavBlob;
    const statusEl = $('#shadowStatus');
    statusEl.classList.remove('err');
    statusEl.textContent = '识别中…';
    let text = '';
    try {
      text = await Asr.transcribe(res);
    } catch (err) {
      const msg = err && err.message ? err.message : '识别失败';
      statusEl.classList.add('err');
      statusEl.textContent = msg;
      toast(msg);
      return;
    }
    handleShadowResult(text);
  }

  function handleShadowResult(text) {
    const statusEl = $('#shadowStatus');
    statusEl.classList.remove('err');
    statusEl.textContent = '';
    $('#shadowResult').classList.remove('hidden');

    const ref = lastCue ? (lastCue.primary || lastCue.text) : '';
    const scoreNum = $('#scoreNum');
    let score = null;
    if (ref) {
      const r = Scorer.compare(ref, text);
      score = r.score;
      scoreNum.textContent = String(score);
      scoreNum.className = score >= 80 ? 'good' : (score >= 60 ? 'mid' : 'bad');
      $('#diffRef').innerHTML = r.refTokens.map(function (t) {
        return '<span class="' + t.cls + '">' + escHtml(t.t) + '</span>';
      }).join(' ');
      $('#diffHyp').innerHTML = r.hypTokens.map(function (t) {
        return '<span class="' + t.cls + '">' + escHtml(t.t) + '</span>';
      }).join(' ');
    } else {
      scoreNum.textContent = '--';
      scoreNum.className = '';
      $('#diffRef').textContent = '';
      $('#diffHyp').textContent = text;
    }

    const now = new Date();
    const at = ('0' + now.getHours()).slice(-2) + ':' + ('0' + now.getMinutes()).slice(-2);
    const hist = store.get(HISTORY_KEY) || [];
    hist.unshift({ score: score, ref: ref, hyp: text, at: at });
    store.set(HISTORY_KEY, hist.slice(0, 50));
    renderHistory();
  }

  /* ================= 初始化 ================= */

  Settings.load();
  Settings.bindForm();
  Settings.onChange = function (key, val) {
    if (key === 'seekStep') {
      $('#seekStepLabel').textContent = val + 's';
      $('#seekStepLabel2').textContent = val + 's';
    } else if (key === 'subFont') {
      subtitleOverlay.style.fontSize = val + 'px';
    }
  };

  Player.init(video);
  Player.onTime = function (info) {
    if (!seeking) {
      $('#seekBar').value = info.dur > 0 ? Math.round(info.cur / info.dur * 1000) : 0;
    }
    $('#timeCur').textContent = fmtTime(info.cur);
    $('#timeDur').textContent = fmtTime(info.dur);
    $('#btnPlay').textContent = video.paused ? '▶' : '⏸';
    /* 播放中节流保存进度 */
    if (!video.paused && Date.now() - lastSave > 5000) {
      lastSave = Date.now();
      saveProgressNow();
    }
  };
  Player.onCueChange = function (disp, index) {
    const cue = disp ? disp.cue : null;
    if (cue) {
      lastCue = cue; /* 供跟读参考 */
      /* 跟读参考只取原文 */
      $('#shadowRef').textContent = cue.primary || cue.text;
    }
    lastDisp = disp;
    transHidden = false; /* 新句子：收起状态重置 */
    Translate.setCurrentContext(disp && disp.primary ? disp.primary : '');
    Translate.hideWordPopup(); /* 换句后关闭查词弹窗 */
    renderOverlay(disp);
    highlightSubItem(index);
  };
  Player.onEnded = function () {
    if (Settings.get('autoNext')) Playlist.next();
  };

  /* 进度记忆：暂停即存、播完清除、关窗兜底保存 */
  video.addEventListener('pause', saveProgressNow);
  video.addEventListener('ended', function () {
    const it = Playlist.items[Playlist.current];
    if (it) removeProgress(it.path);
  });
  window.addEventListener('beforeunload', saveProgressNow);

  /* 字幕 overlay 点击：整句翻译按钮 / 点词查词 */
  subtitleOverlay.addEventListener('click', function (e) {
    if (e.target.closest('.sub-tr')) {
      translateCurrentSentence();
      return;
    }
    const w = e.target.closest('span.w');
    if (w) {
      const r = $('#videoWrap').getBoundingClientRect();
      Translate.showWordPopup(w.dataset.w || '', e.clientX - r.left, e.clientY - r.top);
    }
  });

  Playlist.onPlay = async function (item) {
    $('#nowPlaying').textContent = item.name;
    document.title = item.name + ' - 语言学习播放器';
    renderPlaylist();
    savePlaylistState();
    $('#videoPlaceholder').classList.add('hidden');
    lastCue = null;
    $('#shadowRef').textContent = '播放视频后，这里显示当前字幕';
    /* 进度记忆：只在「超过开头且未到片尾」时定位 */
    const prog = (store.get(PROGRESS_KEY) || {})[item.path];
    const resumeT = Settings.get('resume') && prog && prog.t > 10 && prog.d && prog.t < prog.d - 8 ? prog.t : 0;
    Player.open(item.url, { autoplay: !Player.muteOpen, startAt: resumeT });
    if (resumeT > 0) toast('已定位到上次播放位置 ' + fmtTime(resumeT));

    let loaded = false;
    try {
      /* 1. 手动选过字幕的绑定优先 */
      const binding = (store.get(BINDING_KEY) || {})[item.path];
      if (binding && binding.length) {
        loaded = await loadSubtitleFiles(binding, { expectPath: item.path });
        if (loaded) return;
        removeBinding(item.path); /* 绑定失效（字幕文件被删/移动），回退自动查找 */
      }
      /* 2. 同名自动查找 */
      const subPaths = await window.native.findSubtitlesForVideo(item.path);
      const stillCurrent = Playlist.items[Playlist.current] && Playlist.items[Playlist.current].path === item.path;
      if (stillCurrent && subPaths.length) {
        /* expectPath：字幕加载完成后再次核对，防止快速切台时串台 */
        loaded = await loadSubtitleFiles(subPaths, { expectPath: item.path });
      } else if (!subPaths.length) {
        toast('未找到匹配的字幕文件，可手动加载');
      }
    } catch (err) {
      toast('字幕加载失败：' + (err && err.message ? err.message : '未知错误'));
    }
    if (!loaded && Playlist.items[Playlist.current] && Playlist.items[Playlist.current].path === item.path) {
      Player.setCues([]);
      renderSubList();
    }
  };
  Playlist.onChange = function () {
    renderPlaylist();
    savePlaylistState();
  };

  /* 恢复持久化状态到播放器与 UI */
  Player.setVolume(Settings.get('volume'));
  Player.setSpeed(Settings.get('speed'));
  Player.subMode = Settings.get('subMode') || 'both';
  Player.lastSubMode = 'both';
  Player.loopCue = !!Settings.get('loopCue');
  subUiSync();
  syncLoopBtn();
  syncVolumeUi();
  updateSpeedLabel();
  subtitleOverlay.style.fontSize = Settings.get('subFont') + 'px';
  $('#seekStepLabel').textContent = Settings.get('seekStep') + 's';
  $('#seekStepLabel2').textContent = Settings.get('seekStep') + 's';
  renderHistory();

  Hotkeys.init({
    playPause: function () { Player.toggle(); },
    seekFwd: function () { Player.seekBy(Settings.get('seekStep')); },
    seekBack: function () { Player.seekBy(-Settings.get('seekStep')); },
    volUp: function () { changeVolume(5); },
    volDown: function () { changeVolume(-5); },
    mute: function () { Player.toggleMute(); syncVolumeUi(); },
    speedUp: function () { Player.speedUp(); updateSpeedLabel(); },
    speedDown: function () { Player.speedDown(); updateSpeedLabel(); },
    prevCue: function () { Player.prevCue(); },
    nextCue: function () { Player.nextCue(); },
    restartCue: function () { Player.restartCue(); },
    loopCue: function () { Player.toggleLoopCue(); syncLoopBtn(); },
    toggleSub: function () { handleToggleSub(); },
    subLang: function () { handleCycleSubLang(); },
    translateCue: function () { translateCurrentSentence(); },
    record: function () { toggleRecord(); },
    fullscreen: function () { Player.toggleFullscreen(); },
    prevTrack: function () { Playlist.prev(); },
    nextTrack: function () { Playlist.next(); }
  });
  Hotkeys.renderTable($('#hotkeyTable'));

  /* ================= 顶栏 ================= */

  $('#btnOpenVideo').addEventListener('click', async function () {
    const ps = await window.native.chooseVideos();
    if (ps && ps.length) Playlist.add(ps);
  });
  $('#btnAddVideos').addEventListener('click', async function () {
    const ps = await window.native.chooseVideos();
    if (ps && ps.length) Playlist.add(ps);
  });
  $('#btnOpenFolder').addEventListener('click', async function () {
    const ps = await window.native.chooseFolder();
    if (ps && ps.length) Playlist.add(ps);
  });
  $('#btnAddFolder').addEventListener('click', async function () {
    const ps = await window.native.chooseFolder();
    if (ps && ps.length) Playlist.add(ps);
  });
  $('#btnOpenSub').addEventListener('click', async function () {
    const ps = await window.native.chooseSubtitle();
    if (!ps || !ps.length) return;
    loadSubtitleFiles(ps);
  });
  $('#btnClearPlaylist').addEventListener('click', function () {
    Playlist.clear();
    try { video.pause(); } catch (e) { /* 忽略 */ }
    video.removeAttribute('src');
    video.load();
    $('#videoPlaceholder').classList.remove('hidden');
    $('#nowPlaying').textContent = '';
    document.title = '语言学习播放器';
    Player.setCues([]);
    renderSubList();
    lastCue = null;
    $('#shadowRef').textContent = '播放视频后，这里显示当前字幕';
  });

  /* ================= 播放列表交互 ================= */

  $('#playlist').addEventListener('click', function (e) {
    const li = e.target.closest('.p-item');
    if (!li) return;
    const i = Number(li.dataset.index);
    if (e.target.closest('.del')) { Playlist.remove(i); return; }
    Playlist.play(i);
  });

  /* ================= 控制条 ================= */

  $('#btnPlay').addEventListener('click', function () { Player.toggle(); });
  $('#btnPrevTrack').addEventListener('click', function () { Playlist.prev(); });
  $('#btnNextTrack').addEventListener('click', function () { Playlist.next(); });
  $('#btnSeekBack').addEventListener('click', function () { Player.seekBy(-Settings.get('seekStep')); });
  $('#btnSeekFwd').addEventListener('click', function () { Player.seekBy(Settings.get('seekStep')); });
  $('#btnPrevCue').addEventListener('click', function () { Player.prevCue(); });
  $('#btnNextCue').addEventListener('click', function () { Player.nextCue(); });
  $('#btnCueRestart').addEventListener('click', function () { Player.restartCue(); });
  $('#btnLoopCue').addEventListener('click', function () {
    Player.toggleLoopCue();
    syncLoopBtn();
  });
  $('#btnSpeedUp').addEventListener('click', function () { Player.speedUp(); updateSpeedLabel(); });
  $('#btnSpeedDown').addEventListener('click', function () { Player.speedDown(); updateSpeedLabel(); });
  $('#btnMute').addEventListener('click', function () { Player.toggleMute(); syncVolumeUi(); });
  $('#volBar').addEventListener('input', function () {
    Player.setVolume(Number(this.value));
    syncVolumeUi();
  });
  $('#btnToggleSub').addEventListener('click', function () { handleToggleSub(); });
  $('#btnSubLang').addEventListener('click', function () { handleCycleSubLang(); });
  $('#btnRecord').addEventListener('click', function () { toggleRecord(); });
  $('#btnFullscreen').addEventListener('click', function () { Player.toggleFullscreen(); });

  $('#seekBar').addEventListener('input', function () {
    seeking = true;
    const d = video.duration;
    if (isFinite(d) && d > 0) Player.seekTo(Number(this.value) / 1000 * d);
  });
  $('#seekBar').addEventListener('change', function () {
    seeking = false;
  });

  /* ================= 字幕页 ================= */

  $('#subFilter').addEventListener('input', function () { renderSubList(); });
  $('#subList').addEventListener('click', function (e) {
    const item = e.target.closest('.s-item');
    if (!item) return;
    const c = Player.cues[Number(item.dataset.index)];
    if (c) Player.seekTo(c.start + 0.01);
  });

  /* ================= 跟读页 ================= */

  $('#btnRecord2').addEventListener('click', function () { toggleRecord(); });
  $('#btnHearRef').addEventListener('click', function () { Player.restartCue(); });
  $('#btnPlayMyVoice').addEventListener('click', function () {
    if (lastVoiceBlob) Recorder.playBlob(lastVoiceBlob);
    else toast('还没有录音可播放');
  });
  $('#btnClearHistory').addEventListener('click', function () {
    store.set(HISTORY_KEY, []);
    renderHistory();
    toast('已清空跟读记录');
  });

  /* ================= 设置页 ================= */

  $('#btnResetHotkeys').addEventListener('click', function () {
    Hotkeys.reset();
    Hotkeys.renderTable($('#hotkeyTable'));
    toast('已恢复默认快捷键');
  });

  /* ================= Tab 切换 ================= */

  $('#tabs').addEventListener('click', function (e) {
    const btn = e.target.closest('.tab');
    if (btn) switchTab(btn.dataset.tab);
  });

  /* 所有按钮点击后 blur，防止空格键重复触发 */
  ['#topbar', '#controls', '#tabs', '#sidebar'].forEach(function (sel) {
    $(sel).addEventListener('click', function (e) {
      const b = e.target.closest('button');
      if (b) b.blur();
    });
  });

  /* ================= 拖放 ================= */

  window.addEventListener('dragover', function (e) { e.preventDefault(); });
  window.addEventListener('drop', function (e) {
    e.preventDefault();
    const files = Array.prototype.slice.call(e.dataTransfer ? e.dataTransfer.files : []);
    const videos = [];
    const subs = [];
    files.forEach(function (f) {
      const p = window.native.pathForFile(f);
      if (!p) return;
      const ext = extOf(p);
      if (VIDEO_EXTS.indexOf(ext) !== -1) videos.push(p);
      else if (SUB_EXTS.indexOf(ext) !== -1) subs.push(p);
    });
    if (videos.length) Playlist.add(videos);
    if (subs.length) loadSubtitleFiles(subs);
  });

  /* ================= 启动恢复 ================= */

  /* 恢复上次的播放列表与当前视频（暂停态定位，不自动出声），字幕照常加载 */
  const psState = store.get(PLSTATE_KEY);
  if (Settings.get('resume') && psState && Array.isArray(psState.paths) && psState.paths.length) {
    const items = psState.paths.map(function (p) {
      return { path: p, url: filePathToUrl(p), name: String(p).split(/[\\/]/).pop() };
    });
    Playlist.restore(items, Math.min(psState.current || 0, items.length - 1));
    if (Playlist.current >= 0) {
      Player.muteOpen = true; /* 本次 open 不自动播放 */
      Playlist.play(Playlist.current);
      Player.muteOpen = false;
      toast('已恢复上次播放列表（' + items.length + ' 个视频），按空格继续', 3500);
    }
  }
});
