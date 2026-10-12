/* 应用入口：全部 UI 接线（DOM 就绪后启动） */
document.addEventListener('DOMContentLoaded', function () {
  'use strict';

  const VIDEO_EXTS = ['.mp4', '.m4v', '.mkv', '.webm', '.mov', '.avi', '.wmv', '.ts', '.mpg', '.mpeg', '.3gp', '.ogv', '.flv'];
  const SUB_EXTS = ['.srt', '.ass', '.ssa', '.vtt'];
  const HISTORY_KEY = 'llp.shadowHistory';

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

  function refreshOverlay() {
    subtitleOverlay.textContent = (Player.subVisible && lastCue) ? lastCue.text : '';
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

  function toggleSubUi() {
    Player.toggleSub();
    $('#btnToggleSub').classList.toggle('active', Player.subVisible);
    refreshOverlay();
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

  function renderSubList() {
    const cues = Player.cues || [];
    const q = ($('#subFilter').value || '').trim().toLowerCase();
    const parts = [];
    for (let i = 0; i < cues.length; i++) {
      const c = cues[i];
      if (q && String(c.text || '').toLowerCase().indexOf(q) === -1) continue;
      parts.push('<div class="s-item" data-index="' + i + '">' +
        '<div class="s-time">' + fmtTime(c.start) + ' → ' + fmtTime(c.end) + '</div>' +
        '<div class="s-text">' + escHtml(c.text || '') + '</div></div>');
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

  async function loadSubtitleFile(path) {
    try {
      const sub = await window.native.readSubtitle(path);
      Player.setCues(Subtitles.parse(sub.text, extOf(path)));
      renderSubList();
      switchTab('subs');
      toast('已加载字幕：' + sub.name);
    } catch (err) {
      toast('加载字幕失败：' + (err && err.message ? err.message : '未知错误'));
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

    const ref = lastCue ? lastCue.text : '';
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
  Player.onCueChange = function (cue, index) {
    subtitleOverlay.textContent = (cue && Player.subVisible) ? cue.text : '';
    if (cue) {
      lastCue = cue;
      $('#shadowRef').textContent = cue.text;
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
      const subPath = await window.native.findSubtitleForVideo(item.path);
      const stillCurrent = Playlist.items[Playlist.current] && Playlist.items[Playlist.current].path === item.path;
      if (subPath && stillCurrent) {
        const sub = await window.native.readSubtitle(subPath);
        Player.setCues(Subtitles.parse(sub.text, extOf(subPath)));
        renderSubList();
        loaded = true;
        toast('已自动加载字幕：' + sub.name);
      } else if (!subPath) {
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
  Player.subVisible = !!Settings.get('subVisible');
  Player.loopCue = !!Settings.get('loopCue');
  $('#btnToggleSub').classList.toggle('active', Player.subVisible);
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
    toggleSub: function () { toggleSubUi(); },
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
    const p = await window.native.chooseSubtitle();
    if (p) loadSubtitleFile(p);
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
  $('#btnToggleSub').addEventListener('click', function () { toggleSubUi(); });
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
    subs.forEach(function (p) { loadSubtitleFile(p); });
  });
});
