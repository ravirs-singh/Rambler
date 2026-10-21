# Flow Clone

A small, open-source voice dictation app in the style of Wispr Flow. Hold a key,
speak, release: the transcript is cleaned up and pasted into whatever app has
focus. Built from the architecture recovered in
`../wispr-flow-reverse-engineering.md`.

```
hold key ─► mic (16 kHz AudioWorklet) ─► streaming STT ─► local clean-up ─► Claude formatting
                                   ▲                                              │
         field context (app, text before/after caret) ────────────────────────────┤
                                                                                  ▼
                             clipboard write ─► paste chord ─► clipboard restore ─► verify
```

## What it does

- **Trigger**: a global key (default Right Option on macOS, Right Ctrl on
  Windows/Linux) captured with `uiohook-napi`. Hold = push-to-talk, double tap =
  hands-free lock, Escape = cancel. Same state machine shape as the original.
- **Audio**: a hidden renderer owns the microphone and an `AudioWorklet` that
  emits 100 ms Int16 PCM chunks at 16 kHz. The mic stays warm between takes.
- **Speech to text** (pluggable):
  - `local` (default): a whisper.cpp or faster-whisper server on this machine
    through the OpenAI-compatible endpoint. No key, no cost.
  - `deepgram`: realtime WebSocket, interim results stream into the overlay
    while you talk, dictionary words are sent as key terms.
  - `openai`: any OpenAI-compatible `/audio/transcriptions` endpoint
    (OpenAI, Groq, a local whisper.cpp or faster-whisper server). Audio is
    uploaded as WAV on release.
- **Formatting**: deterministic rules (spoken punctuation, "new paragraph",
  filler removal, dictionary casing and replacements) by default, plus an
  optional Claude pass (`claude-opus-5-5`, low effort, server-side fallbacks
  enabled) that receives the app name, the text before/after the caret and the
  dictionary so the output fits the field. If the LLM is unavailable the local
  result is used.
- **Context**: a tiny native helper reads the focused field through
  Accessibility (macOS, Swift) or UI Automation (Windows, PowerShell). Without
  it the app still works, it just knows less.
- **Insertion**: clipboard write, synthetic Cmd/Ctrl+V, clipboard restore after
  700 ms, optional read-back verification through the helper. `type` mode
  sends keystrokes for apps that block paste; `clipboard` mode only writes
  the clipboard. Works with Electron 45's async clipboard and the older sync
  API (`src/main/insert/clipboard.js`).
- **Overlay**: a non-focusable always-on-top pill with a level meter, streaming
  text and start/stop tones.
- **Local data**: `history.jsonl` (transcript, final text, app, per-stage
  latency) and `dictionary.json` in the user-data directory. Settings window
  from the tray.

## Free setup (default)

Out of the box nothing costs money and no key is needed: speech recognition
runs on a whisper.cpp server on your own machine, and formatting uses the
local rules. Start the server once, then the app.

```bash
# 1. whisper.cpp server (macOS: brew install whisper-cpp; Linux/Windows: build
#    from https://github.com/ggml-org/whisper.cpp or grab a release)
curl -L -o ggml-base.en.bin \
  https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin
whisper-server -m ggml-base.en.bin --port 8080 --inference-path /v1/audio/transcriptions

# 2. the app
npm install
npm start
```

`base.en` is fast on any laptop; `small.en` or `medium.en` are more accurate
if your machine can keep up. Any other OpenAI-compatible local server works
too (faster-whisper / Speaches): point `stt.local.baseUrl` at it in Settings.

## Paid options (optional)

```bash
export DEEPGRAM_API_KEY=...        # streaming provider with live text; $200 free credit
export OPENAI_API_KEY=...          # hosted OpenAI-compatible transcription
export ANTHROPIC_API_KEY=...       # Claude formatting pass (or `ant auth login`)
```

Switch providers in the tray menu or the settings window.

macOS: grant **Accessibility** and **Input Monitoring** to Electron (or the
packaged app) for the global key and the paste chord, and **Microphone**.
Build the context helper once with `npm run build:helper:mac` (needs the Xcode
command line tools). Linux: `xdotool` is used for the paste chord.

Settings live in `<userData>/config.json` (see `src/main/config.js` for every
key and default).

## Test

```bash
npm test          # unit tests: trigger state machine, text rules, providers, config
npm run smoke     # headless end-to-end: fake mic device + fake STT, checks the clipboard
```

The smoke run exercises the real Electron windows, worklet capture, IPC, the
pipeline and clipboard insertion without network or a real microphone. On a
headless Linux box run it as `xvfb-run -a npm run smoke`.

Status: unit tests and the headless smoke run pass on Linux. The Deepgram and
Claude paths are written against their documented APIs but were not run here
(no credentials in the build container). The macOS Swift helper and the
Windows PowerShell helper are untested on real machines; the app degrades to
app-name-only context without them.

## Layout

```
src/main/index.js          app bootstrap, tray, smoke runner
src/main/hotkey.js         trigger state machine + uiohook binding
src/main/dictation.js      take pipeline (capture → STT → format → insert → verify → history)
src/main/providers/        deepgram (streaming), openai (batch), fake
src/main/formatter/        Claude formatter + prompt builder
src/main/text/postprocess.js  local rules
src/main/context/          focused-field context (helpers + fallbacks)
src/main/insert/           clipboard + paste chord + restore
src/main/windows.js        capture bridge, overlay, settings windows
src/renderer/              capture page + worklet, overlay pill, settings UI
helper/macos/ax-context.swift, helper/windows/ax-context.ps1
test/                      node:test suites
```

## Differences from the original

The original ships its own speech and formatting models behind a gRPC stream
with heartbeats and an HTTP race, encodes audio as Opus, reads on-screen
vocabulary through OCR, and tracks post-paste edits to learn corrections. This
clone keeps the same stages and interfaces but uses public APIs, raw PCM, and
a manual dictionary.
