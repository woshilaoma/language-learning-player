'use strict';

// 字幕解析与检索：支持 .srt / .vtt / .ass / .ssa。
// 解析结果统一为 [{ start, end, text }]：时间单位是秒（float），
// text 内多行用 \n 连接，整体按 start 升序，空文本条目丢弃。

// 按空行把全文切成块（每块是若干非空行组成的数组）
function _stSplitBlocks(text) {
  const lines = text.split('\n');
  const blocks = [];
  let cur = [];
  for (const line of lines) {
    if (line.trim() === '') {
      if (cur.length) blocks.push(cur);
      cur = [];
    } else {
      cur.push(line);
    }
  }
  if (cur.length) blocks.push(cur);
  return blocks;
}

// 时间码 → 秒。兼容 'HH:MM:SS,mmm' / 'H:MM:SS.cc' / 'MM:SS.mmm' / 'M:SS'，
// 毫秒分隔符逗号或点均可；解析失败返回 NaN。
function _stParseTime(s) {
  const m = String(s).trim().match(/^(?:(\d+):)?(\d+):(\d+)(?:[.,](\d+))?$/);
  if (!m) return NaN;
  const h = m[1] ? parseInt(m[1], 10) : 0;
  const frac = m[4] ? parseInt(m[4].padEnd(3, '0'), 10) / 1000 : 0;
  return h * 3600 + parseInt(m[2], 10) * 60 + parseInt(m[3], 10) + frac;
}

// 时间行 '00:00:01,500 --> 00:00:04,000 参数...' → { start, end }
// '-->' 后的位置参数（VTT）以及行尾多余内容一律忽略
function _stParseArrowLine(line) {
  const idx = line.indexOf('-->');
  if (idx < 0) return null;
  const start = _stParseTime(line.slice(0, idx));
  const endStr = line.slice(idx + 3).trim().split(/\s+/)[0];
  const end = _stParseTime(endStr);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return { start, end };
}

// 去掉 <...> HTML 标签和 {\...} 特效标记（如 SRT 的 {\an8}）
function _stCleanText(s) {
  return s.replace(/<[^>]*>/g, '').replace(/\{\\[^}]*\}/g, '').trim();
}

function _stByStart(a, b) {
  return a.start - b.start;
}

// 判断单行文本的文字体系：统计 CJK 字符（汉字 \u4e00-\u9fff / 扩展A \u3400-\u4dbf、
// 日文假名 \u3040-\u30ff、韩文谚文 \uac00-\ud7af）与拉丁字母的数量，
// 多者胜出；两类都为 0（空行或只有数字/符号）返回 '' 表示无法判断
function lineScript(line) {
  const s = String(line || '');
  let cjk = 0;
  let latin = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if ((c >= 0x4e00 && c <= 0x9fff) || (c >= 0x3400 && c <= 0x4dbf) ||
        (c >= 0x3040 && c <= 0x30ff) || (c >= 0xac00 && c <= 0xd7af)) {
      cjk++;
    } else if ((c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a)) {
      latin++;
    }
  }
  if (cjk === 0 && latin === 0) return '';
  return cjk >= latin ? 'cjk' : 'latin';
}

// SRT / VTT 共用：块内找含 '-->' 的行作时间行（序号行自然被忽略），
// 其后各行用 \n 连接为文本
function _stParseCueBlocks(text, skipBlock) {
  const cues = [];
  for (const lines of _stSplitBlocks(text)) {
    if (skipBlock && skipBlock(lines)) continue;
    const ti = lines.findIndex((l) => l.indexOf('-->') >= 0);
    if (ti < 0) continue;
    const times = _stParseArrowLine(lines[ti]);
    if (!times) continue;
    const body = _stCleanText(lines.slice(ti + 1).join('\n'));
    if (!body) continue;
    cues.push({ start: times.start, end: times.end, text: body });
  }
  cues.sort(_stByStart);
  return cues;
}

function _stParseSrt(text) {
  return _stParseCueBlocks(text, null);
}

// VTT 的头部 / NOTE / STYLE / REGION 块跳过（首词判断，避免误伤 'style-1' 这类 cue id）
function _stIsVttMeta(lines) {
  const head = lines[0].trim().toUpperCase().split(/\s+/)[0];
  return head === 'WEBVTT' || head === 'NOTE' || head === 'STYLE' || head === 'REGION';
}

function _stParseVtt(text) {
  return _stParseCueBlocks(text, _stIsVttMeta);
}

// ASS 台词文本：{\...} override 标记去除，\N 和 \n 转成换行
function _stCleanAssText(s) {
  return s.replace(/\{\\[^}]*\}/g, '').replace(/\\[Nn]/g, '\n').trim();
}

// ASS/SSA：只处理 [Events] 段内、Format: 行之后的 Dialogue: 行（Comment: 等跳过），
// 字段顺序以 Format 为准；Text 是最后一个字段，split 后重新 join 防止台词含逗号被截断
function _stParseAss(text) {
  const cues = [];
  const lines = text.split('\n');
  let section = '';
  let format = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.charAt(0) === '[' && line.charAt(line.length - 1) === ']') {
      section = line.slice(1, -1).trim().toLowerCase();
      format = null;
      continue;
    }
    if (section !== 'events') continue;
    const ci = line.indexOf(':');
    if (ci < 0) continue;
    const kind = line.slice(0, ci).trim().toLowerCase();
    const rest = line.slice(ci + 1);
    if (kind === 'format') {
      format = rest.split(',').map((f) => f.trim().toLowerCase());
    } else if (kind === 'dialogue' && format) {
      const si = format.indexOf('start');
      const ei = format.indexOf('end');
      const ti = format.indexOf('text');
      if (si < 0 || ei < 0 || ti < 0) continue;
      const fields = rest.split(',');
      const start = _stParseTime(fields[si]);
      const end = _stParseTime(fields[ei]);
      if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
      const body = _stCleanAssText(fields.slice(ti).join(','));
      if (!body) continue;
      cues.push({ start, end, text: body });
    }
    // 其余行（Comment: / Picture: / Sound: 等）一律跳过
  }
  cues.sort(_stByStart);
  return cues;
}

const Subtitles = {
  // 解析字幕文本。ext 形如 '.srt'/'.vtt'/'.ass'/'.ssa'（大小写、带不带点均可）
  parse(text, ext) {
    const src = String(text || '').replace(/\r/g, '').replace(/^\uFEFF/, '');
    const e = String(ext || '').toLowerCase().replace(/^\./, '');
    if (e === 'vtt') return _stParseVtt(src);
    if (e === 'ass' || e === 'ssa') return _stParseAss(src);
    return _stParseSrt(src);
  },

  // 二分：最后一个 start <= t 的下标，无则 -1
  findCueIndexAt(cues, t) {
    let lo = 0;
    let hi = cues.length - 1;
    let res = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (cues[mid].start <= t) {
        res = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return res;
  },

  // 二分：start <= t < end 的下标（当前正在显示的句子），无则 -1。
  // 先二分定位最后一个 start <= t，再向前跨过已结束的 cue，容忍少量重叠
  findCueVisibleIndex(cues, t) {
    let i = this.findCueIndexAt(cues, t);
    while (i >= 0 && cues[i].end <= t) i--;
    return i;
  },

  // 整段字幕文本按行投票判断主要文字体系，返回 'cjk' | 'latin' | ''
  //（无法判断的行不投票；两类票数为 0 时返回 ''）
  dominantScript(text) {
    let cjk = 0;
    let latin = 0;
    const lines = String(text || '').split('\n');
    for (let i = 0; i < lines.length; i++) {
      const k = lineScript(lines[i]);
      if (k === 'cjk') cjk++;
      else if (k === 'latin') latin++;
    }
    if (cjk === 0 && latin === 0) return '';
    return cjk >= latin ? 'cjk' : 'latin';
  },

  // 分析单条字幕轨是否为「一句两行」的双语字幕。
  // 对每个 cue 设置 primary（原文）/ secondary（译文，可为 ''），
  // 返回 { bilingual }。
  //  - multiLineCues：非空行数 >= 2 的 cue 数
  //  - mixedCues   ：其中第 1、2 行文字体系不同的数量
  //  - bilingual = multiLineCues > 0 && mixedCues / multiLineCues >= 0.5
  // 双语时先投票确定原文（primary）所在行：若多数 cue 是「第 1 行 cjk 且
  // 第 2 行非 cjk」或相反，primary 取非 cjk 的那行（学习语言通常是外文）；
  // 否则 primary 固定取第 1 行。单行 cue 的 primary 即该行、secondary 为 ''，
  // 第 3 行起并入 secondary（\n 连接）。
  analyzeBilingual(cues) {
    const list = cues || [];
    let multiLineCues = 0;
    let mixedCues = 0;
    let cjkFirst = 0;  /* 第 1 行 cjk、第 2 行非 cjk 的 cue 数 */
    let cjkSecond = 0; /* 第 1 行非 cjk、第 2 行 cjk 的 cue 数 */
    const splitLines = function (cue) {
      return String(cue.text || '').split('\n').filter(function (l) { return l.trim() !== ''; });
    };
    for (let i = 0; i < list.length; i++) {
      const lines = splitLines(list[i]);
      if (lines.length < 2) continue;
      multiLineCues++;
      const k1 = lineScript(lines[0]);
      const k2 = lineScript(lines[1]);
      if (k1 !== k2) mixedCues++;
      const a = k1 === 'cjk';
      const b = k2 === 'cjk';
      if (a && !b) cjkFirst++;
      else if (b && !a) cjkSecond++;
    }
    const bilingual = multiLineCues > 0 && mixedCues / multiLineCues >= 0.5;
    /* 原文（primary）所在行：多数为「cjk 在上」→ 原文在第 2 行；其余情况取第 1 行 */
    const primaryPos = cjkFirst > cjkSecond ? 1 : 0;
    for (let i = 0; i < list.length; i++) {
      const cue = list[i];
      if (!bilingual) {
        cue.primary = cue.text;
        cue.secondary = '';
        continue;
      }
      const lines = splitLines(cue);
      if (lines.length === 0) {
        cue.primary = '';
        cue.secondary = '';
      } else if (lines.length === 1) {
        cue.primary = lines[0];
        cue.secondary = '';
      } else if (primaryPos === 0) {
        cue.primary = lines[0];
        cue.secondary = lines.slice(1).join('\n');
      } else {
        cue.primary = lines[1];
        cue.secondary = [lines[0]].concat(lines.slice(2)).join('\n');
      }
    }
    return { bilingual: bilingual };
  }
};

// Node 单测支持（浏览器中不执行，无副作用）
if (typeof module !== 'undefined' && module.exports) {
  module.exports = Subtitles;
}
