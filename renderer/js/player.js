/* 播放器核心：进度、逐句跳转、循环本句、倍速、音量、字幕显示模式、全屏 */
const Player = {
  SPEEDS: [0.25, 0.5, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3],

  video: null,
  cues: [],
  secondaryCues: [],          /* 双文件模式下的译文轨（独立时间轴） */
  cueIndex: -1,
  loopCue: false,
  subMode: 'both',            /* 'both' | 'primary' | 'secondary' | 'off' */
  lastSubMode: 'both',        /* 隐藏前的模式，恢复显示用 */
  lastDisp: { primary: '', secondary: '', cue: null },
  pendingSeek: 0,             /* 打开后定位到的时间（loadedmetadata 时应用） */
  muteOpen: false,            /* 一次性：open 时不自动播放（启动恢复用） */

  /* 由 app 赋值的回调 */
  /* onCueChange(disp, index)：disp = { primary, secondary, cue }
     —— primary/secondary 是当前应显示的原文/译文文本（无则 ''），
     cue 为当前主字幕对象（可能带 primary/secondary 字段），index 为 -1 时 cue 为 null */
  onCueChange: null,
  onTime: null,      /* ({ cur, dur }) */
  onEnded: null,     /* () */

  init(videoEl) {
    this.video = videoEl;
    this.cues = [];
    this.secondaryCues = [];
    this.cueIndex = -1;
    videoEl.addEventListener('ended', () => {
      if (this.onEnded) this.onEnded();
    });
    videoEl.addEventListener('loadedmetadata', () => {
      if (this.pendingSeek > 0 && isFinite(videoEl.duration)) {
        videoEl.currentTime = Math.min(this.pendingSeek, videoEl.duration - 1);
      }
      this.pendingSeek = 0;
    });
    videoEl.addEventListener('error', () => {
      toast(I18N.t('toast.videoLoadFail'));
    });
    setInterval(() => { this.tick(); }, 80);
  },

  /* opts：{ autoplay: true, startAt: 0 }
     autoplay=false 时不调用 play()（src 赋值 + load()，暂停态等待用户操作）；
     startAt>0 时在 loadedmetadata 后定位（进度记忆 / 恢复播放用） */
  open(url, opts) {
    const v = this.video;
    if (!v) return;
    opts = opts || {};
    this.cues = [];
    this.secondaryCues = [];
    this.cueIndex = -1;
    this.lastDisp = { primary: '', secondary: '', cue: null };
    this.pendingSeek = opts.startAt > 0 ? Number(opts.startAt) : 0;
    v.src = url;
    v.load();
    if (opts.autoplay !== false) {
      const p = v.play();
      if (p && p.catch) p.catch(() => { /* 自动播放被拒绝时忽略 */ });
    }
    if (this.onCueChange) this.onCueChange({ primary: '', secondary: '', cue: null }, -1);
  },

  play() {
    const p = this.video.play();
    if (p && p.catch) p.catch(() => { /* 忽略 */ });
  },

  pause() {
    this.video.pause();
  },

  toggle() {
    if (this.video.paused) this.play();
    else this.pause();
  },

  seekBy(sec) {
    this.seekTo(this.video.currentTime + sec);
  },

  seekTo(sec) {
    const v = this.video;
    if (!v || !isFinite(sec)) return;
    const dur = isFinite(v.duration) ? v.duration : 0;
    if (dur > 0) sec = clamp(sec, 0, Math.max(0, dur - 0.05));
    else sec = Math.max(0, sec);
    const wasPlaying = !v.paused && !v.ended;
    v.currentTime = sec;
    if (wasPlaying && v.paused) this.play(); /* 保持播放状态 */
  },

  /* 设置字幕：cues 为主字幕轨；secondaryCues 可选，是第二个字幕文件
     解析出的译文轨（按各自时间轴对齐，不重排）。重置进度并强制刷新一次显示 */
  setCues(cues, secondaryCues) {
    this.cues = cues || [];
    this.secondaryCues = Array.isArray(secondaryCues) ? secondaryCues : [];
    this.cueIndex = -1;
    this.lastDisp = { primary: '', secondary: '', cue: null };
    this.emitCue(true);
  },

  activeCueIndex() {
    return Subtitles.findCueVisibleIndex(this.cues, this.video.currentTime);
  },

  nearestCueIndex() {
    return Subtitles.findCueIndexAt(this.cues, this.video.currentTime);
  },

  prevCue() {
    if (!this.cues.length) return;
    const active = this.activeCueIndex();
    const i = active >= 0 ? active : this.nearestCueIndex();
    const target = Math.max(0, i - 1);
    this.seekTo(this.cues[target].start + 0.01);
  },

  nextCue() {
    if (!this.cues.length) return;
    let i = this.nearestCueIndex();
    if (i < 0) i = 0;
    const target = Math.min(this.cues.length - 1, i + 1);
    this.seekTo(this.cues[target].start + 0.01);
  },

  restartCue() {
    if (!this.cues.length) return;
    const active = this.activeCueIndex();
    const i = active >= 0 ? active : this.nearestCueIndex();
    if (i < 0) return;
    this.seekTo(this.cues[i].start + 0.01);
    /* 暂停状态下重听原声：从句首直接播放（prevCue/nextCue 仍保持原播放状态） */
    if (this.video.paused) this.play();
  },

  toggleLoopCue() {
    this.loopCue = !this.loopCue;
    Settings.set('loopCue', this.loopCue);
    return this.loopCue;
  },

  /* ---------- 倍速 ---------- */

  gearIndex() {
    let best = 0;
    let dist = Infinity;
    for (let i = 0; i < this.SPEEDS.length; i++) {
      const d = Math.abs(this.SPEEDS[i] - this.video.playbackRate);
      if (d < dist) { dist = d; best = i; }
    }
    return best;
  },

  speedUp() {
    const i = Math.min(this.SPEEDS.length - 1, this.gearIndex() + 1);
    return this.setSpeed(this.SPEEDS[i]);
  },

  speedDown() {
    const i = Math.max(0, this.gearIndex() - 1);
    return this.setSpeed(this.SPEEDS[i]);
  },

  setSpeed(v) {
    v = Number(v);
    if (!isFinite(v) || v <= 0) v = 1;
    this.video.playbackRate = v;
    Settings.set('speed', v);
    return v;
  },

  /* ---------- 音量 / 字幕 / 全屏 ---------- */

  setVolume(v) {
    v = clamp(Math.round(Number(v) || 0), 0, 100);
    this.video.volume = v / 100;
    Settings.set('volume', v);
    return v;
  },

  toggleMute() {
    this.video.muted = !this.video.muted;
    return this.video.muted;
  },

  /* 是否存在译文：第二字幕轨非空，或主轨 cue 自带 secondary（单文件双语） */
  hasSecondary() {
    if (this.secondaryCues.length > 0) return true;
    return (this.cues || []).some(function (c) { return !!c.secondary; });
  },

  /* 设置字幕显示模式（both/primary/secondary/off），持久化并强制刷新当前显示 */
  setSubMode(m) {
    this.subMode = m;
    Settings.set('subMode', m);
    this.emitCue(true);
  },

  /* 循环切换语言模式 both → primary → secondary → both；无译文时返回 null。
     当前为 off 时从上次的模式继续切（顺带恢复显示） */
  cycleSubLang() {
    if (!this.hasSecondary()) return null;
    const order = ['both', 'primary', 'secondary'];
    const cur = this.subMode !== 'off' ? this.subMode : (this.lastSubMode || 'both');
    const next = order[(order.indexOf(cur) + 1) % order.length];
    this.setSubMode(next);
    return next;
  },

  /* 显示 / 隐藏字幕：隐藏前记住模式，恢复时还原 */
  toggleSub() {
    if (this.subMode !== 'off') {
      this.lastSubMode = this.subMode;
      this.setSubMode('off');
    } else {
      this.setSubMode(this.lastSubMode || 'both');
    }
    return this.subMode;
  },

  toggleFullscreen() {
    const wrap = document.getElementById('videoWrap');
    if (document.fullscreenElement) {
      const p = document.exitFullscreen();
      if (p && p.catch) p.catch(() => { /* 忽略 */ });
    } else {
      const p = wrap.requestFullscreen();
      if (p && p.catch) p.catch(() => { toast(I18N.t('toast.cannotFullscreen')); });
    }
  },

  /* ---------- tick ---------- */

  /* 计算当前时刻的显示内容并按需触发 onCueChange。
     force=true 时跳过变化检测强制触发（换模式 / 换字幕后刷新显示用） */
  emitCue(force) {
    if (!this.video) return;
    const t = this.video.currentTime;
    const idx = Subtitles.findCueVisibleIndex(this.cues, t);
    const cue = idx >= 0 ? this.cues[idx] : null;
    const disp = { primary: '', secondary: '', cue: cue };
    if (cue) disp.primary = cue.primary != null ? cue.primary : cue.text;
    if (cue && cue.secondary) {
      disp.secondary = cue.secondary;
    } else {
      /* 单文件双语未拆出译文、或主轨 cue 无 secondary 时，
         从第二字幕轨按时间轴找当前译文 */
      const si = Subtitles.findCueVisibleIndex(this.secondaryCues, t);
      if (si >= 0) {
        const c = this.secondaryCues[si];
        disp.secondary = (c.primary != null ? c.primary : c.text) || '';
      }
    }
    if (force || idx !== this.cueIndex ||
        disp.primary !== this.lastDisp.primary || disp.secondary !== this.lastDisp.secondary) {
      this.cueIndex = idx;
      this.lastDisp = disp;
      if (this.onCueChange) this.onCueChange(disp, idx);
    }
  },

  tick() {
    const v = this.video;
    if (!v) return;
    const t = v.currentTime;
    const idx = Subtitles.findCueVisibleIndex(this.cues, t);
    /* 循环本句：上一 tick 还是本句、此刻刚结束 → 跳回句首 */
    if (this.loopCue && idx < 0 && this.cueIndex >= 0 && this.cues[this.cueIndex]) {
      const c = this.cues[this.cueIndex];
      if (t >= c.end - 0.05 && t < c.end + 2) {
        this.seekTo(c.start);
        return;
      }
    }
    this.emitCue(false);
    if (this.onTime) this.onTime({ cur: t, dur: isFinite(v.duration) ? v.duration : 0 });
  }
};
