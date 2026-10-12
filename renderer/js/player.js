/* 播放器核心：进度、逐句跳转、循环本句、倍速、音量、字幕可见性、全屏 */
const Player = {
  SPEEDS: [0.25, 0.5, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3],

  video: null,
  cues: [],
  cueIndex: -1,
  loopCue: false,
  subVisible: true,

  /* 由 app 赋值的回调 */
  onCueChange: null, /* (cue|null, index) */
  onTime: null,      /* ({ cur, dur }) */
  onEnded: null,     /* () */

  init(videoEl) {
    this.video = videoEl;
    this.cues = [];
    this.cueIndex = -1;
    videoEl.addEventListener('ended', () => {
      if (this.onEnded) this.onEnded();
    });
    setInterval(() => { this.tick(); }, 80);
  },

  open(url) {
    const v = this.video;
    if (!v) return;
    this.cues = [];
    this.cueIndex = -1;
    v.src = url;
    const p = v.play();
    if (p && p.catch) p.catch(() => { /* 自动播放被拒绝时忽略 */ });
    if (this.onCueChange) this.onCueChange(null, -1);
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

  setCues(cues) {
    this.cues = cues || [];
    this.cueIndex = -1;
    if (this.onCueChange) this.onCueChange(null, -1);
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

  toggleSub() {
    this.subVisible = !this.subVisible;
    Settings.set('subVisible', this.subVisible);
    return this.subVisible;
  },

  toggleFullscreen() {
    const wrap = document.getElementById('videoWrap');
    if (document.fullscreenElement) {
      const p = document.exitFullscreen();
      if (p && p.catch) p.catch(() => { /* 忽略 */ });
    } else {
      const p = wrap.requestFullscreen();
      if (p && p.catch) p.catch(() => { toast('无法进入全屏'); });
    }
  },

  /* ---------- tick ---------- */

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
    if (idx !== this.cueIndex) {
      this.cueIndex = idx;
      if (this.onCueChange) this.onCueChange(idx >= 0 ? this.cues[idx] : null, idx);
    }
    if (this.onTime) this.onTime({ cur: t, dur: isFinite(v.duration) ? v.duration : 0 });
  }
};
