# 语言学习播放器（Windows 版）

[English](README.md) | **简体中文**

基于 Electron 的本地视频播放器，专为语言学习设计：外挂字幕、逐句精听、可自定义快捷键、麦克风跟读打分、播放列表。全部本地运行，无需服务器和账号。

## 启动

```bash
npm install     # 首次
npm start
```

## 功能与用法

### 1. 播放视频 / 播放列表
- 顶栏「打开视频」（可多选）或「打开文件夹」（自动扫描视频文件）加入播放列表。
- 支持把视频 / 字幕文件直接拖进窗口。
- 支持格式：mp4、m4v、mkv、webm、mov、avi、wmv、ts、mpg、3gp、ogv、flv。
- 「设置 → 自动播放下一个」控制播完是否自动切下一个（默认开）。

### 2. 字幕
- 支持加载 .srt / .vtt / .ass / .ssa，自动识别编码（UTF-8 / UTF-16 / GB18030）。
- **自动加载**：播放视频时自动寻找同目录同名字幕（如 `movie.mp4` + `movie.srt`，或 `movie.zh.srt`）。
- 手动加载：顶栏「加载字幕」。
- 字幕页支持全文搜索、点击任意句子跳转播放、当前句高亮自动滚动。
- 字幕字号可在设置中调整；`H` 键隐藏/显示字幕。

### 3. 快捷键（默认，均可在设置页重新绑定）
| 按键 | 功能 | 按键 | 功能 |
|---|---|---|---|
| 空格 | 播放/暂停 | `←` / `→` | 快退/快进（秒数） |
| `↑` / `↓` | 音量 ±5 | `M` | 静音 |
| `.` / `,` | 加速/减速（0.25x–3x） | `[` / `]` | 上一句/下一句 |
| `Enter` | 回到本句开头 | `L` | 循环播放本句 |
| `H` | 显示/隐藏字幕 | `R` | 录音跟读 |
| `F` | 全屏 | `PageUp` / `PageDown` | 上一个/下一个视频 |

### 4. 两种快进快退
- **按秒**：`←` / `→`，秒数在设置页配置（默认 5 秒）。
- **按句**：`[` / `]` 按字幕时间轴跳上一句/下一句；`Enter` 重听本句；`L` 单句循环（精听模式）。

### 5. 跟读打分（语音识别）
播放到某句 → 按 `R` 开始录音 → 再按 `R` 停止 → 自动语音识别 → 与当前字幕文本比对打分（0–100），逐词标注：绿色=正确、红色删除线=漏读、红色下划线=读错。历史记录保留最近 50 条。

识别引擎二选一（设置页配置）：

**方式 A：OpenAI 兼容接口（推荐，开箱即用）**
- 服务地址：`https://api.openai.com/v1`，或任意兼容服务（Groq `https://api.groq.com/openai/v1`、硅基流动 `https://api.siliconflow.cn/v1`、本地 `http://127.0.0.1:9000/v1` 等）
- 模型名：OpenAI 用 `whisper-1`；其他服务参考其文档（如 `whisper-large-v3`）

**方式 B：本地 whisper.cpp（完全离线）**
1. 下载 [whisper.cpp](https://github.com/ggml-org/whisper.cpp) 编译或获取预编译的 `whisper-cli.exe`
2. 下载 GGML 模型（如 `ggml-base.bin` 或 `ggml-large-v3.bin`）
3. 设置页填入两个路径，识别方式选「本地 whisper.cpp 命令行」

### 6. 数据存储
设置、快捷键、跟读记录保存在本地（Chromium localStorage），不上传任何数据。

## 目录结构

```
main.js            主进程：窗口、文件对话框、字幕文件读取、whisper.cpp 调用
preload.js         桥接层：window.native 安全 API
renderer/
  index.html       页面结构
  css/app.css      样式
  js/
    utils.js       工具（时间格式化、toast、存储、file:// URL）
    subtitles.js   字幕解析（SRT/VTT/ASS/SSA）+ 时间查找
    scorer.js      文本比对打分（归一化 + LCS 对齐）
    recorder.js    麦克风采集 → 16kHz WAV
    asr.js         语音识别（API / whisper.cpp）
    hotkeys.js     可重绑定的全局快捷键
    player.js      播放器核心（逐句跳转、循环、倍速）
    playlist.js    播放列表
    settings.js    设置持久化 + 表单绑定
    app.js         入口：全部 UI 接线
```
