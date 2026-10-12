/* 应用入口：全部 UI 接线（DOM 就绪后启动） */
document.addEventListener('DOMContentLoaded', function () {
  'use strict';

  const VIDEO_EXTS = ['.mp4', '.m4v', '.mkv', '.webm', '.mov', '.avi', '.wmv', '.ts', '.mpg', '.mpeg', '.3gp', '.ogv', '.flv'];
  const SUB_EXTS = ['.srt', '.ass', '.ssa', '.vtt'];
  const HISTORY_KEY = 'llp.shadowHistory';
  const SUB_MODE_LABELS = { both: '双语', primary: '原文', secondary: '译文' };

  const video = $('#video');
  const subtitleOverlay = $('#subtitleOverlay');
  const subPage = $('.page[data-page="subs"]');

  let seeking = false;
  let lastCue = null;        /* 最近一条字幕，跟读参考用 */
  let recTimer = null;
  let recStart = 0;
  let lastVoiceBlob = null;  /* 最近一次跟读录音，供「播放我的录音」 */

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
     已不是该路径则放弃应用（返回 false）。成功返回 true。 */
  async function loadSubtitleFiles(paths, opts) {
    if (!paths || !paths.length) return false;
    const expectPath = opts && opts.expectPath ? opts.expectPath : null;
    const isStale = function () {
      return !!expectPath &&
        !(Playlist.items[Playlist.current] && Playlist.items[Playlist.current].path === expectPath);
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
      return true;
    } catch (err) {
      toast('加载字幕失败：' + (err && err.message ? err.message : '未知错误'));
      return false;
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
  };
  Player.onCueChange = function (disp, index) {
    const cue = disp ? disp.cue : null;
    if (cue) {
      lastCue = cue; /* 供跟读参考 */
      /* 跟读参考只取原文 */
      $('#shadowRef').textContent = cue.primary || cue.text;
    }
    if (Player.subMode === 'off' || !cue) {
      subtitleOverlay.innerHTML = '';
    } else {
      /* 译文模式但字幕没有译文时，兜底显示原文 */
      const showPrimary = Player.subMode !== 'secondary' || !Player.hasSecondary();
      const showSecondary = Player.subMode !== 'primary' && !!disp.secondary;
      let html = '';
      if (showPrimary) html += '<div class="sub-p">' + escHtml(disp.primary || '') + '</div>';
      if (showSecondary) html += '<div class="sub-s">' + escHtml(disp.secondary) + '</div>';
      subtitleOverlay.innerHTML = html;
    }
    highlightSubItem(index);
  };
  Player.onEnded = function () {
    if (Settings.get('autoNext')) Playlist.next();
  };

  Playlist.onPlay = async function (item) {
    $('#nowPlaying').textContent = item.name;
    document.title = item.name + ' - 语言学习播放器';
    renderPlaylist();
    $('#videoPlaceholder').classList.add('hidden');
    lastCue = null;
    $('#shadowRef').textContent = '播放视频后，这里显示当前字幕';
    Player.open(item.url);

    let loaded = false;
    try {
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
  Playlist.onChange = function () { renderPlaylist(); };

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
});
