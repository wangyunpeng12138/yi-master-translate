# 译境 · Yijing

[English](./README.md) | [简体中文](./README.zh-CN.md)

**译境**（Yijing）是一款开源的双语网页翻译 Chrome 扩展（Manifest V3）。译文直接渲染在原文段落下方，无需离开页面即可双语对照阅读外文网页。

> 「译境」取「沉浸之境」之意——在原文语境中沉浸式阅读译文。

本项目为使用 TypeScript 从零独立实现的开源工程，与其他产品的关系见[免责声明](#免责声明)。

## 功能特性

### 核心翻译

- **双语对照翻译**——智能识别页面主区域、段落级批量翻译、带 loading 圆环的渐进渲染、滚动到可视区域再翻译的真·懒翻译
- **翻译服务**
  - 内置免费通道：微软翻译、谷歌翻译、腾讯 TranSmart、DeepLX（自建端点）
  - 自定义 OpenAI 兼容服务，提供**一键预设模板**：Ollama / ChatGPT / DeepSeek / Kimi——选预设、贴 API Key 即可
  - **本地 AI 优先**：本地服务（Ollama）无需 API Key 开箱即用；通过 DNR 规则自动移除 `Origin` 请求头，本地推理服务可直接接受扩展请求
- **AI 精翻**——领域专家提示词（科技/学术/法律/金融）、全局追加提示词、逐服务的模型与限速配置
- **段落 AI 搜索**——每段译文后出现 🔍 按钮，点击即可获得该段术语/典故的 AI 科普解释，支持缓存与 txt 导出

### 阅读体验

- 译文样式主题（虚线下划线 / 背景高亮 / 学习模式模糊）、双语或仅译文显示
- 每段译文起始处有「译」小标签，固定标示翻译开始
- 悬浮球三态（未翻译 / 翻译中 / 已完成）；翻译中再次点击可终止翻译
- 段落长度阈值、标题翻译、侧边栏区域等均可精细控制

### 更多能力

- 输入框翻译、划词翻译、圈选翻译、鼠标悬停翻译
- 已有字幕轨视频的双语字幕
- 图片/漫画翻译（本地 OCR：tesseract.js 随扩展打包，无需云端额度）
- 网络代理接管（PAC 分域），应对直连不可达环境
- 术语库、AI 专家、AI Write（润色 / 翻译写作）
- 配置导入导出、本地翻译缓存、丰富快捷键（Alt+A …）

### 明确不做（设计取舍）

会员付费体系、遥测、云同步、EPUB 在线制作、无字幕视频的云端 ASR 识别。

## 快速开始

### 环境要求

- [Node.js](https://nodejs.org/) ≥ 20
- [pnpm](https://pnpm.io/) ≥ 9

### 构建与加载

```bash
pnpm install
pnpm build          # 产物输出到 .output/chrome-mv3
```

1. 打开 `chrome://extensions`
2. 开启**开发者模式**
3. 点击**加载已解压的扩展程序**，选择 `.output/chrome-mv3` 目录

### 开发调试

```bash
pnpm dev        # WXT 开发服务器（热更新）
pnpm typecheck  # vue-tsc 类型检查
pnpm test       # vitest 单元测试
pnpm zip        # 打包可分发的 zip
```

## 目录结构

```
src/
├── core/          # 配置存储、服务注册表、适配器、限流队列、缓存
├── engine/        # 内容脚本引擎：walker、translator、renderer、悬浮球 …
├── entrypoints/   # popup / options / sidepanel / aiwrite / background / offscreen
├── components/    # 共享 Vue 组件（ServicePicker、LangPicker …）
└── …
```

## 免责声明

本项目为个人学习研究目的的**独立开源实现**，与「沉浸式翻译」（Immersive Translate）及其官方（Funstory.ai Limited）**无任何关联或授权关系**。「沉浸式翻译」名称及相关权利归其权利人所有；文中出现的其他产品名称、商标均为其各自权利人的财产，仅作事实性描述使用。

## 致谢

- 功能基线参考了沉浸式翻译商店版（v1.34.4）的公开行为
- [WXT](https://wxt.dev/)——扩展开发框架
- [Vue 3](https://vuejs.org/) / [Element Plus](https://element-plus.org/) / [Pinia](https://pinia.vuejs.org/)
- [tesseract.js](https://github.com/naptha/tesseract.js)——浏览器端 OCR（Apache-2.0）

## 许可协议

[MIT](./LICENSE) © Yijing Translate Contributors
