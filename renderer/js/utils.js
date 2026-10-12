'use strict';

// 通用工具：DOM 查询、数值/时间格式化、HTML 转义、提示条、localStorage 封装。
// 经典浏览器脚本（index.html 中最先加载），所有函数直接暴露在全局。
// 注意：所有 DOM / localStorage 访问都在函数体内，Node 中 require 本文件不会崩溃。

function $(sel, root = document) {
  return root.querySelector(sel);
}

// querySelectorAll 的数组版本（方便 map/filter/forEach）
function $$(sel, root = document) {
  return Array.from(root.querySelectorAll(sel));
}

// 把 v 限制在 [a, b] 区间内
function clamp(v, a, b) {
  return Math.min(Math.max(v, a), b);
}

// 秒数 → 'h:mm:ss'（>= 1 小时）或 'm:ss'；非法输入（NaN/undefined/Infinity/负数）→ '0:00'
function fmtTime(sec) {
  const t = Number(sec);
  if (!Number.isFinite(t) || t < 0) return '0:00';
  const s = Math.floor(t);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const mm = String(m).padStart(2, '0');
  const s2 = String(ss).padStart(2, '0');
  return h > 0 ? h + ':' + mm + ':' + s2 : m + ':' + s2;
}

// HTML 转义（& 必须最先替换）
function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// 底部提示条：#toast 设置文本并加 .show，ms 毫秒后自动隐藏；重复调用会重置计时
let _toastTimer = null;

function toast(msg, ms = 2200) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  if (_toastTimer) clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => {
    el.classList.remove('show');
    _toastTimer = null;
  }, ms);
}

// localStorage 的 JSON 封装；环境没有 localStorage 或读写抛异常时，静默降级为内存对象
const store = {
  _mem: {},
  get(key, def) {
    try {
      const raw = localStorage.getItem(key);
      if (raw === null || raw === undefined) return def;
      return JSON.parse(raw);
    } catch (e) {
      return key in this._mem ? this._mem[key] : def;
    }
  },
  set(key, val) {
    try {
      localStorage.setItem(key, JSON.stringify(val));
    } catch (e) {
      this._mem[key] = val;
    }
  }
};

// 本地文件路径 → file:// URL：反斜杠转正斜杠，encodeURI 后再把 '#'、'?' 转义
function filePathToUrl(p) {
  const path = encodeURI(String(p).replace(/\\/g, '/'));
  return 'file:///' + path.replace(/#/g, '%23').replace(/\?/g, '%3F');
}

// Blob → base64 字符串（去掉 'data:...;base64,' 前缀），供录音等上传接口使用
function b64FromBlob(blob) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => {
      const s = String(fr.result);
      const i = s.indexOf(';base64,');
      resolve(i >= 0 ? s.slice(i + 8) : s);
    };
    fr.onerror = () => reject(fr.error || new Error('b64FromBlob: read failed'));
    fr.readAsDataURL(blob);
  });
}

// Node 单测支持（浏览器中不执行，无副作用）
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { $, $$, clamp, fmtTime, escHtml, toast, store, filePathToUrl, b64FromBlob };
}
