/* 设置：默认值、localStorage 持久化、设置表单双向绑定 */
const Settings = {
  defaults: {
    seekStep: 5,
    autoNext: true,
    subFont: 26,
    provider: 'api',
    apiEndpoint: 'https://api.openai.com/v1',
    apiKey: '',
    apiModel: 'whisper-1',
    wcExe: '',
    wcModel: '',
    asrLanguage: 'auto',
    volume: 100,
    speed: 1,
    subMode: 'both',
    loopCue: false,
    resume: true,
    transProvider: 'free',
    transModel: 'gpt-4o-mini',
    transTarget: 'zh-CN'
  },

  data: {},
  onChange: null, /* (key, val)，由 app 赋值 */

  load() {
    const saved = store.get('llp.settings') || {};
    this.data = Object.assign({}, this.defaults, saved);
    /* 旧版 subVisible 迁移：曾隐藏字幕且从未写过 subMode → off */
    if (saved.subVisible === false && !('subMode' in saved)) this.data.subMode = 'off';
    return this.data;
  },

  save() {
    store.set('llp.settings', this.data);
  },

  get(k) {
    return this.data[k];
  },

  set(k, v) {
    this.data[k] = v;
    this.save();
    if (typeof this.onChange === 'function') this.onChange(k, v);
  },

  bindForm() {
    const byId = function (id) { return document.getElementById(id); };
    const seekStepInput = byId('seekStepInput');
    const autoNextCheck = byId('autoNextCheck');
    const subFontRange = byId('subFontRange');
    const subFontLabel = byId('subFontLabel');
    const providerSelect = byId('providerSelect');
    const apiForm = byId('apiForm');
    const wcForm = byId('wcForm');
    const asrLanguage = byId('asrLanguage');
    const resumeCheck = byId('resumeCheck');
    const transProviderSelect = byId('transProviderSelect');
    const transApiForm = byId('transApiForm');
    const transModelInput = byId('transModelInput');
    const transTargetSelect = byId('transTargetSelect');

    const applyProvider = function (v) {
      apiForm.classList.toggle('hidden', v !== 'api');
      wcForm.classList.toggle('hidden', v !== 'whispercli');
    };
    const applyTransProvider = function (v) {
      transApiForm.classList.toggle('hidden', v !== 'api');
    };

    /* 填充当前值 */
    seekStepInput.value = this.data.seekStep;
    autoNextCheck.checked = !!this.data.autoNext;
    subFontRange.value = this.data.subFont;
    subFontLabel.textContent = this.data.subFont + 'px';
    providerSelect.value = this.data.provider;
    applyProvider(this.data.provider);
    byId('apiEndpoint').value = this.data.apiEndpoint;
    byId('apiKey').value = this.data.apiKey;
    byId('apiModel').value = this.data.apiModel;
    byId('wcExe').value = this.data.wcExe;
    byId('wcModel').value = this.data.wcModel;
    asrLanguage.value = this.data.asrLanguage;
    resumeCheck.checked = !!this.data.resume;
    transProviderSelect.value = this.data.transProvider;
    applyTransProvider(this.data.transProvider);
    transModelInput.value = this.data.transModel;
    transTargetSelect.value = this.data.transTarget;

    /* 双向绑定：input / change -> set -> onChange */
    seekStepInput.addEventListener('input', function () {
      const n = parseInt(this.value, 10);
      if (!isNaN(n)) Settings.set('seekStep', clamp(n, 1, 600));
    });
    autoNextCheck.addEventListener('change', function () {
      Settings.set('autoNext', this.checked);
    });
    subFontRange.addEventListener('input', function () {
      const v = parseInt(this.value, 10);
      subFontLabel.textContent = v + 'px';
      Settings.set('subFont', v);
    });
    providerSelect.addEventListener('change', function () {
      Settings.set('provider', this.value);
      applyProvider(this.value);
    });
    const bindText = function (id, key) {
      byId(id).addEventListener('input', function () {
        Settings.set(key, this.value);
      });
    };
    bindText('apiEndpoint', 'apiEndpoint');
    bindText('apiKey', 'apiKey');
    bindText('apiModel', 'apiModel');
    bindText('wcExe', 'wcExe');
    bindText('wcModel', 'wcModel');
    asrLanguage.addEventListener('change', function () {
      Settings.set('asrLanguage', this.value);
    });
    resumeCheck.addEventListener('change', function () {
      Settings.set('resume', this.checked);
    });
    transProviderSelect.addEventListener('change', function () {
      Settings.set('transProvider', this.value);
      applyTransProvider(this.value);
    });
    transModelInput.addEventListener('input', function () {
      Settings.set('transModel', this.value);
    });
    transTargetSelect.addEventListener('change', function () {
      Settings.set('transTarget', this.value);
    });
  }
};

/* Node 单测支持（浏览器中不执行，无副作用） */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = Settings;
}
