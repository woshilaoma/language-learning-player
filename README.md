# Language Learning Player (Windows)

**English** | [简体中文](README.zh-CN.md)

A local video player built with Electron, designed for language learning: external subtitles, sentence-by-sentence navigation, fully remappable hotkeys, microphone shadowing practice with scoring, and playlists. Everything runs locally — no server, no account.

## Getting Started

```bash
npm install     # first run only
npm start
```

## Features

### 1. Video Playback & Playlist
- Add videos via **Open Videos** (multi-select) or **Open Folder** (auto-scans for video files), or just drag & drop files into the window.
- Supported formats: mp4, m4v, mkv, webm, mov, avi, wmv, ts, mpg, 3gp, ogv, flv.
- Toggle auto-play-next in Settings (on by default).
- **Resume playback**: each video's position is remembered; the next time you open the app, the last playlist and video are restored (paused at your last position — press Space to continue).
- **Video ↔ subtitle binding**: once you manually pick subtitles for a video, they are remembered and auto-loaded every time you play that video.

### 2. Subtitles
- Loads .srt / .vtt / .ass / .ssa with automatic encoding detection (UTF-8 / UTF-16 / GB18030).
- **Bilingual support**: a single subtitle file with two lines per cue (one language per line) is automatically split into primary/secondary; or select two subtitle files together and they are merged on their timelines. Press `S` to cycle the display: both → primary → secondary.
- **Auto-loading**: when a video starts, the player looks for matching subtitles in the same folder (`movie.mp4` + `movie.srt`, or `movie.zh.srt`) — up to two are combined as bilingual.
- Manual loading via **Load Subtitle** in the toolbar (multi-select supported).
- The subtitle panel supports full-text search (both languages), click-to-seek on any line, and auto-scrolling highlight of the current line.
- **Sentence translation**: click the 「译」 button on the subtitle or press `T` to translate the current line (shown as a golden line under the subtitle). Press again to hide/show the translation.
- **Tap-to-look-up words**: click any word (or CJK character) in the subtitle line to get a dictionary popup with pronunciation, part of speech and meanings — plus a 🔊 button to hear it spoken.
- Font size is adjustable in Settings; press `H` to show/hide subtitles.

### 3. Keyboard Shortcuts (all remappable in Settings)

| Key | Action | Key | Action |
|---|---|---|---|
| `Space` | Play / pause | `←` / `→` | Seek back / forward (by seconds) |
| `↑` / `↓` | Volume ±5 | `M` | Mute |
| `.` / `,` | Speed up / down (0.25x–3x) | `[` / `]` | Previous / next sentence |
| `Enter` | Replay current sentence | `L` | Loop current sentence |
| `H` | Show / hide subtitles | `S` | Switch subtitle language |
| `T` | Translate current sentence | `R` | Record shadowing |
| `F` | Fullscreen | `PageUp` / `PageDown` | Previous / next video |

### 4. Two Seek Modes
- **By seconds**: `←` / `→`; the step size is configurable in Settings (default 5 s).
- **By sentence**: `[` / `]` jumps along the subtitle timeline; `Enter` replays the current sentence; `L` loops a single sentence (intensive listening mode).

### 5. Shadowing Practice (Speech Recognition)
Play a sentence → press `R` to start recording → press `R` again to stop → speech recognition runs automatically → your speech is compared with the current subtitle and scored 0–100, with per-word annotation: green = correct, red strikethrough = missed, red underline = mispronounced/extra. The last 50 attempts are kept as history.

Two interchangeable recognition engines (configured in Settings):

**Option A: OpenAI-compatible API (recommended, works out of the box)**
- Endpoint: `https://api.openai.com/v1`, or any compatible service (Groq `https://api.groq.com/openai/v1`, SiliconFlow `https://api.siliconflow.cn/v1`, local `http://127.0.0.1:9000/v1`, etc.)
- Model: `whisper-1` for OpenAI; see your provider's docs otherwise (e.g. `whisper-large-v3`)

**Option B: Local whisper.cpp (fully offline)**
1. Get [whisper.cpp](https://github.com/ggml-org/whisper.cpp) — build it or grab a prebuilt `whisper-cli.exe`
2. Download a GGML model (e.g. `ggml-base.bin` or `ggml-large-v3.bin`)
3. Fill in both paths in Settings and select "Local whisper.cpp CLI" as the provider

### 6. Translation Engines (Settings → Translation)
- **Free (default)**: word lookup via Youdao Dictionary + sentence translation via MyMemory — no configuration needed, works in mainland China without a proxy.
- **OpenAI-compatible API**: reuses the endpoint & API key from the speech recognition settings; set a chat model name (e.g. `gpt-4o-mini`).

### 7. Data Storage
Settings, hotkey bindings and shadowing history are stored locally (Chromium localStorage). Nothing is ever uploaded.

## Project Structure

```
main.js            Main process: window, file dialogs, subtitle reading, whisper.cpp invocation
preload.js         Bridge: safe window.native API
renderer/
  index.html       Page layout
  css/app.css      Styles
  js/
    utils.js       Helpers (time formatting, toast, storage, file:// URLs)
    subtitles.js   Subtitle parsing (SRT/VTT/ASS/SSA) + timeline lookup
    scorer.js      Text comparison scoring (normalization + LCS alignment)
    recorder.js    Microphone capture → 16 kHz WAV
    asr.js         Speech recognition (API / whisper.cpp)
    hotkeys.js     Remappable global hotkeys
    player.js      Player core (sentence jumping, looping, playback speed)
    playlist.js    Playlist
    settings.js    Settings persistence + form binding
    app.js         Entry point: all UI wiring
```
