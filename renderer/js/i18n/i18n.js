/* i18n 核心：字典注册、t(key, params)、data-i18n 静态文本应用、语言切换。
   字典文件（en.js / zh-CN.js / fr.js / de.js / ja.js / ko.js / es.js）先于本文件？——
   顺序：字典文件先加载到 window.I18N_DICT，本文件加载时注册全部。 */
const I18N = (function () {
  'use strict';

  let lang = 'en';
  const dicts = {};

  function register(code, obj) { dicts[code] = obj || {}; }

  /* 取词：当前语言 → 英文兜底 → 键名本身；{x} 占位符替换 */
  function t(key, params) {
    let v = key;
    const d = dicts[lang];
    if (d && Object.prototype.hasOwnProperty.call(d, key)) v = d[key];
    else if (dicts.en && Object.prototype.hasOwnProperty.call(dicts.en, key)) v = dicts.en[key];
    if (params) {
      v = String(v).replace(/\{(\w+)\}/g, function (m, k) {
        return params[k] != null ? String(params[k]) : m;
      });
    }
    return v;
  }

  /* 把静态文本应用到 DOM：data-i18n / data-i18n-title / data-i18n-placeholder */
  function applyDom() {
    const nodes = document.querySelectorAll('[data-i18n]');
    for (let i = 0; i < nodes.length; i++) {
      const v = t(nodes[i].getAttribute('data-i18n'));
      if (v) nodes[i].textContent = v;
    }
    const titled = document.querySelectorAll('[data-i18n-title]');
    for (let i = 0; i < titled.length; i++) titled[i].title = t(titled[i].getAttribute('data-i18n-title'));
    const phs = document.querySelectorAll('[data-i18n-placeholder]');
    for (let i = 0; i < phs.length; i++) phs[i].placeholder = t(phs[i].getAttribute('data-i18n-placeholder'));
  }

  function setLang(code) {
    if (!dicts[code]) code = 'en';
    lang = code;
    document.documentElement.setAttribute('lang', code === 'zh-CN' ? 'zh-CN' : code);
    applyDom();
  }

  function getLang() { return lang; }

  /* 注册已加载的字典文件 */
  const pre = window.I18N_DICT || {};
  Object.keys(pre).forEach(function (k) { register(k, pre[k]); });

  return { t: t, setLang: setLang, getLang: getLang, applyDom: applyDom, register: register };
})();
