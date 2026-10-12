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
  }
};

// Node 单测支持（浏览器中不执行，无副作用）
if (typeof module !== 'undefined' && module.exports) {
  module.exports = Subtitles;
}
