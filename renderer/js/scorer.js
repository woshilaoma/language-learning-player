'use strict';

// 跟读评分：把参考文本（字幕）和语音识别结果都切成 token 序列，
// 做 LCS 对齐后打分。cls：'ok' 匹配 / 'miss' 漏读（ref 有 hyp 无）/ 'bad' 多读或读错（hyp 有 ref 无）。

// CJK 字符（含日文假名、韩文）：逐字作为一个 token
function _scIsCjk(cp) {
  return (cp >= 0x1100 && cp <= 0x11FF) ||  // 韩文字母
         (cp >= 0x3040 && cp <= 0x30FF) ||  // 平假名 + 片假名
         (cp >= 0x3130 && cp <= 0x318F) ||  // 韩文兼容字母
         (cp >= 0x3400 && cp <= 0x4DBF) ||  // CJK 扩展 A
         (cp >= 0x4E00 && cp <= 0x9FFF) ||  // CJK 统一表意文字
         (cp >= 0xAC00 && cp <= 0xD7AF) ||  // 韩文音节
         (cp >= 0xF900 && cp <= 0xFAFF) ||  // CJK 兼容表意文字
         (cp >= 0x20000 && cp <= 0x2A6DF);  // CJK 扩展 B
}

// 其余文字（拉丁/西里尔等字母和数字）按 Unicode 字母数字类累积成词
const _scWordChar = /[\p{L}\p{N}]/u;

// 切词：CJK 逐字；其他语言按非字母数字字符切分。空串 → []
function tokenize(text) {
  const s = String(text || '').toLowerCase();
  const out = [];
  let cur = '';
  for (const ch of s) {
    if (_scIsCjk(ch.codePointAt(0))) {
      if (cur) {
        out.push(cur);
        cur = '';
      }
      out.push(ch);
    } else if (_scWordChar.test(ch)) {
      cur += ch;
    } else if (cur) {
      out.push(cur);
      cur = '';
    }
  }
  if (cur) out.push(cur);
  return out;
}

// 参考文本 vs 识别文本 → { score, refTokens, hypTokens }
// token 形如 { t: '词', cls: 'ok'|'miss'|'bad' }；score = round(200 * 匹配数 / (refN + hypN))，任一为 0 得 0 分
function compare(refText, hypText) {
  const refRaw = tokenize(refText);
  const hypRaw = tokenize(hypText);
  const n = refRaw.length;
  const m = hypRaw.length;

  // dp[i][j] = refRaw[i..] 与 hypRaw[j..] 的 LCS 长度（句子长度有限，O(n*m) 足够）
  const dp = [];
  for (let i = 0; i <= n; i++) dp.push(new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      if (refRaw[i] === hypRaw[j]) {
        dp[i][j] = 1 + dp[i + 1][j + 1];
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

  // 从头沿 dp 回溯对齐：相等 → 双方 'ok'；否则优先消耗 ref（'miss'）或 hyp（'bad'）
  const refTokens = [];
  const hypTokens = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (refRaw[i] === hypRaw[j]) {
      refTokens.push({ t: refRaw[i], cls: 'ok' });
      hypTokens.push({ t: hypRaw[j], cls: 'ok' });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      refTokens.push({ t: refRaw[i], cls: 'miss' });
      i++;
    } else {
      hypTokens.push({ t: hypRaw[j], cls: 'bad' });
      j++;
    }
  }
  while (i < n) {
    refTokens.push({ t: refRaw[i], cls: 'miss' });
    i++;
  }
  while (j < m) {
    hypTokens.push({ t: hypRaw[j], cls: 'bad' });
    j++;
  }

  const matched = dp[0][0];
  const score = (n === 0 || m === 0) ? 0 : Math.round((200 * matched) / (n + m));
  return { score, refTokens, hypTokens };
}

const Scorer = { tokenize, compare };

// Node 单测支持（浏览器中不执行，无副作用）
if (typeof module !== 'undefined' && module.exports) {
  module.exports = Scorer;
}
