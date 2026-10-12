/* 全局快捷键：绑定、存储、重绑（点击捕获新按键）、友好显示 */
const Hotkeys = (function () {
  'use strict';

  const STORE_KEY = 'llp.hotkeys';

  /* 固定顺序即 getAll / 渲染顺序 */
  const DEFAULTS = [
    { action: 'playPause', key: 'Space', label: '播放/暂停' },
    { action: 'seekFwd', key: 'ArrowRight', label: '快进' },
    { action: 'seekBack', key: 'ArrowLeft', label: '快退' },
    { action: 'volUp', key: 'ArrowUp', label: '音量+' },
    { action: 'volDown', key: 'ArrowDown', label: '音量-' },
    { action: 'mute', key: 'KeyM', label: '静音' },
    { action: 'speedUp', key: 'Period', label: '加速' },
    { action: 'speedDown', key: 'Comma', label: '减速' },
    { action: 'prevCue', key: 'BracketLeft', label: '上一句' },
    { action: 'nextCue', key: 'BracketRight', label: '下一句' },
    { action: 'restartCue', key: 'Enter', label: '句首' },
    { action: 'loopCue', key: 'KeyL', label: '循环本句' },
    { action: 'toggleSub', key: 'KeyH', label: '显示/隐藏字幕' },
    { action: 'subLang', key: 'KeyS', label: '切换字幕语言' },
    { action: 'record', key: 'KeyR', label: '录音跟读' },
    { action: 'fullscreen', key: 'KeyF', label: '全屏' },
    { action: 'prevTrack', key: 'PageUp', label: '上一个视频' },
    { action: 'nextTrack', key: 'PageDown', label: '下一个视频' }
  ];

  const MODIFIER_CODES = ['ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'ShiftLeft', 'ShiftRight', 'MetaLeft', 'MetaRight'];

  const KEY_NAMES = {
    Space: '空格',
    ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
    Enter: 'Enter', Escape: 'Esc', Tab: 'Tab', Backspace: 'Backspace',
    Delete: 'Del', Insert: 'Ins', Home: 'Home', End: 'End',
    PageUp: 'Page↑', PageDown: 'Page↓',
    BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: "'",
    Backslash: '\\', Comma: ',', Period: '.', Slash: '/',
    Minus: '-', Equal: '=', Backquote: '`', CapsLock: 'CapsLock'
  };

  let bindings = {};   /* action -> combo 字符串 | null */
  let handlers = {};
  let capturing = null; /* 处于捕获态的 action */
  let container = null;

  function load() {
    const saved = store.get(STORE_KEY) || {};
    bindings = {};
    DEFAULTS.forEach(function (d) {
      bindings[d.action] = Object.prototype.hasOwnProperty.call(saved, d.action) ? saved[d.action] : d.key;
    });
  }

  function persist() {
    store.set(STORE_KEY, bindings);
  }

  function comboFromEvent(e) {
    const parts = [];
    if (e.ctrlKey) parts.push('Ctrl');
    if (e.altKey) parts.push('Alt');
    if (e.shiftKey) parts.push('Shift');
    parts.push(e.code);
    return parts.join('+');
  }

  function isEditable(el) {
    if (!el) return false;
    const tag = el.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable === true;
  }

  function onKeydown(e) {
    /* 捕获态：全局分发暂停，下一次 keydown 即新绑定 */
    if (capturing) {
      e.preventDefault();
      e.stopPropagation();
      if (MODIFIER_CODES.indexOf(e.code) !== -1) return; /* 纯修饰键忽略 */
      const action = capturing;
      capturing = null;
      if (e.code === 'Escape') {
        renderTable();
        toast('已取消设置快捷键');
        return;
      }
      if (e.code === 'Backspace') {
        setCombo(action, null);
        renderTable();
        toast('已清除快捷键：' + labelOf(action));
        return;
      }
      const combo = comboFromEvent(e);
      setCombo(action, combo);
      renderTable();
      toast(labelOf(action) + ' → ' + comboLabel(combo));
      return;
    }
    if (isEditable(document.activeElement)) return;
    const combo = comboFromEvent(e);
    for (let i = 0; i < DEFAULTS.length; i++) {
      const a = DEFAULTS[i].action;
      if (bindings[a] && bindings[a] === combo) {
        e.preventDefault(); /* 注意 Space 默认滚动 */
        if (handlers[a]) handlers[a](e);
        return;
      }
    }
  }

  function labelOf(action) {
    for (let i = 0; i < DEFAULTS.length; i++) {
      if (DEFAULTS[i].action === action) return DEFAULTS[i].label;
    }
    return action;
  }

  function keyName(code) {
    if (KEY_NAMES[code]) return KEY_NAMES[code];
    let m = /^Key([A-Z])$/.exec(code);
    if (m) return m[1];
    m = /^Digit([0-9])$/.exec(code);
    if (m) return m[1];
    m = /^Numpad([0-9])$/.exec(code);
    if (m) return '小键盘' + m[1];
    return code;
  }

  function comboLabel(combo) {
    if (!combo) return '未绑定';
    const parts = combo.split('+');
    const key = parts.pop();
    return parts.concat([keyName(key)]).join(' + ');
  }

  function getAll() {
    return DEFAULTS.map(function (d) {
      return { action: d.action, label: d.label, combo: bindings[d.action] || null };
    });
  }

  function setCombo(action, combo) {
    if (!Object.prototype.hasOwnProperty.call(bindings, action)) return;
    bindings[action] = combo || null;
    persist();
  }

  function reset() {
    DEFAULTS.forEach(function (d) { bindings[d.action] = d.key; });
    persist();
  }

  function renderTable(el) {
    if (el) container = el;
    if (!container) return;
    container.textContent = '';
    getAll().forEach(function (row) {
      const wrap = document.createElement('div');
      wrap.className = 'hk-row';
      const label = document.createElement('span');
      label.className = 'hk-label';
      label.textContent = row.label;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'hk-key';
      if (capturing === row.action) {
        btn.classList.add('capturing');
        btn.textContent = '按新按键…（Esc取消 Backspace清除）';
      } else {
        btn.textContent = comboLabel(row.combo);
      }
      btn.addEventListener('click', function () {
        capturing = (capturing === row.action) ? null : row.action;
        renderTable();
      });
      wrap.appendChild(label);
      wrap.appendChild(btn);
      container.appendChild(wrap);
    });
  }

  function init(hs) {
    handlers = hs || {};
    load();
    document.addEventListener('keydown', onKeydown);
  }

  return {
    init: init,
    getAll: getAll,
    setCombo: setCombo,
    reset: reset,
    comboLabel: comboLabel,
    renderTable: renderTable
  };
})();
