/* 播放列表：增删、去重、环绕切换 */
const Playlist = {
  items: [],   /* [{ path, url, name }] */
  current: -1,

  /* 由 app 赋值的回调 */
  onPlay: null,   /* (item, index) */
  onChange: null, /* () */

  add(paths) {
    if (!Array.isArray(paths)) paths = [paths];
    let added = false;
    paths.forEach((p) => {
      if (!p) return;
      if (this.items.some((it) => it.path === p)) return; /* 按 path 去重 */
      this.items.push({
        path: p,
        url: filePathToUrl(p),
        name: String(p).split(/[\\/]/).pop()
      });
      added = true;
    });
    if (!added) return;
    if (this.current === -1 && this.items.length) this.play(0);
    else if (this.onChange) this.onChange();
  },

  remove(i) {
    if (i < 0 || i >= this.items.length) return;
    this.items.splice(i, 1);
    if (!this.items.length) {
      this.clear();
      return;
    }
    if (i === this.current) {
      /* 删除的是当前项：接着播放补位项；onPlay 内部会触发列表刷新 */
      this.play(Math.min(i, this.items.length - 1));
      return;
    }
    if (i < this.current) this.current--;
    if (this.onChange) this.onChange();
  },

  clear() {
    this.items = [];
    this.current = -1;
    if (this.onChange) this.onChange();
  },

  /* 从持久化状态恢复列表（items 为 [{path,url,name}]，current 可为 -1），不触发播放 */
  restore(items, current) {
    this.items = items;
    this.current = current;
    if (this.onChange) this.onChange();
  },

  play(i) {
    if (i < 0 || i >= this.items.length) return;
    this.current = i;
    if (this.onPlay) this.onPlay(this.items[i], i);
  },

  next() {
    if (!this.items.length) return;
    this.play((this.current + 1) % this.items.length);
  },

  prev() {
    if (!this.items.length) return;
    this.play((this.current - 1 + this.items.length) % this.items.length);
  }
};
