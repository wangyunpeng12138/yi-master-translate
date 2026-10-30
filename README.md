# Yidashi · 译大师

[English](./README.md) | [简体中文](./README.zh-CN.md)

**Yidashi** (译大师) is an open-source bilingual web page translation extension for Chrome (Manifest V3). It renders translations inline, right below each original paragraph, so you can read foreign pages bilingually without leaving the page.

> **Yidashi** (译大师) means "Master of Translation" — your personal translation master right in the browser.

This project is an independent implementation written from scratch in TypeScript. See the [disclaimer](#disclaimer) for its relationship with other products.

## Features

### Core translation

- **Bilingual inline translation** — smart main-content detection, paragraph-level batching, progressive rendering with loading spinners, and lazy translation as you scroll
- **Translation services**
  - Built-in free channels: Microsoft Translator, Google Translate, Tencent TranSmart, DeepLX (self-hosted endpoint)
  - Custom OpenAI-compatible services with **one-click presets**: Ollama / ChatGPT / DeepSeek / Kimi — pick a preset, paste your API key, done
  - **Local-first AI**: local services (Ollama) work out of the box with no API key; a DNR rule transparently removes the `Origin` header so local inference servers accept extension requests
- **AI fine translation** — domain expert prompts (tech / academic / legal / financial), a global append prompt, per-service model & rate-limit tuning
- **Paragraph AI search** — a 🔍 button appears after each translated paragraph; click it to get an AI-generated explanation of terms and allusions in context, with caching and txt export

### Reading experience

- Translation themes (dashed underline / background highlight / blur for study mode), bilingual or translation-only display
- A small "译" badge marks the start of every translation
- Floating ball with three states (idle / translating / done); click again while translating to cancel
- Full control over paragraph length thresholds, title translation, sidebar areas, and more

### More capabilities

- Input-box translation, selection translation, circle-select, and mouse-hover translation
- Bilingual subtitles for videos with existing subtitle tracks
- Image / manga translation via local OCR (tesseract.js, bundled — no cloud quota)
- Network proxy takeover (PAC) for restricted environments
- Terminology library, AI experts, AI Write (polish / translate-and-write)
- Config import/export, local translation cache, rich keyboard shortcuts (Alt+A …)

### Explicitly not included (by design)

Membership/paywall, telemetry, cloud sync, online EPUB building, and cloud ASR for subtitle-less videos.

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) ≥ 20
- [pnpm](https://pnpm.io/) ≥ 9

### Build & load

```bash
pnpm install
pnpm build          # outputs to .output/chrome-mv3
```

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** and select the `.output/chrome-mv3` folder

### Development

```bash
pnpm dev        # WXT dev server with hot reload
pnpm typecheck  # vue-tsc
pnpm test       # vitest unit tests
pnpm zip        # package a distributable zip
```

## Project structure

```
src/
├── core/          # config store, service registry, adapters, queue, cache
├── engine/        # content-script engine: walker, translator, renderer, floatball …
├── entrypoints/   # popup / options / sidepanel / aiwrite / background / offscreen
├── components/    # shared Vue components (ServicePicker, LangPicker …)
└── …
```

## Disclaimer

This project is an **independent, open-source implementation** created for personal learning and research. It is **not affiliated with, endorsed by, or authorized by** *Immersive Translate* (沉浸式翻译) or Funstory.ai Limited. "沉浸式翻译 / Immersive Translate" is a trademark of its respective owner. All product names, trademarks and registered trademarks are the property of their respective owners and are used here only for factual, referential description.

## Acknowledgements

- Feature baseline referenced the public behavior of the *Immersive Translate* store build (v1.34.4)
- [WXT](https://wxt.dev/) — the extension framework
- [Vue 3](https://vuejs.org/) / [Element Plus](https://element-plus.org/) / [Pinia](https://pinia.vuejs.org/)
- [tesseract.js](https://github.com/naptha/tesseract.js) — in-browser OCR (Apache-2.0)

## License

[MIT](./LICENSE) © Yidashi Translate Contributors
