# x.com 适配方案：页面内容检测翻译 + 视频 CC 字幕翻译

> **文档定位**：专项技术方案（Thinking → Design），不是最终实现。确认后按第 7 节分阶段落地。
> **参考产物**：沉浸式翻译商店版 v1.34.4 编译产物（`E:\chrome-ext-dev\chenjinshifanyi`），本文所有"原版怎么做的"结论均给出可复核的文件与字节偏移。
> **本仓库现状基线**：`src/engine/*`（P3/P6/P8a 已落地）、`src/core/*`（无站点规则层）。
> **写作日期**：2026-11-09

---

## 0. 结论速览（TL;DR）

x.com 是**两个完全独立的技术问题**，不要混在一套代码里做：

| 问题 | 本质 | 技术路线 | 是否需要 MAIN world 注入 | 原版对应 |
| --- | --- | --- | --- | --- |
| ① 检测并翻译 x.com 页面内容（推文、长文、简介、悬浮卡、Grok、通知） | 文本在 DOM 里，但选择器与生命周期和普通站点完全不同（SPA + 虚拟列表 + 混淆 class） | **站点规则层 + SPA 感知的增量段落扫描**；绝对不要改 DOM 结构，只在段落末尾追加译文本 | ❌ 不需要 | 站点规则 `twitter`（41 个键） |
| ② 翻译 x.com 视频的 CC 字幕 | 字幕文本**不在 DOM 里**，也不在 `<track>` 上可靠可取；它是播放器挂在 `<video>` 上的 **TextTrack** | **接管 `video.textTracks`（保留 cues、抑制原生绘制）+ 自绘双语字幕层** | ❌ 不需要（TextTrack API 跨 world 可见） | `subtitleRule.type = "twitter"` + v1.17.3 的 `attachRule` |

三条最重要的判断：

1. **本仓库现在在 x.com 上"几乎什么都没翻"**。理由见 §2.1：段落识别器只认 `p/h1/li/td...`，而推文正文是 `div[data-testid="tweetText"]`；且没有站点规则层、没有 SPA 路由监听、没有内容 MutationObserver。这不是"效果不好"，是"命中为 0"。
   → **已真机验证（§10）**：默认配置下 x.com 采集到 0 段；且存在第二道更硬的闸门——`html[lang]=zh-cn`（界面语言）触发 `sameLangCheck` 整页跳过。
2. **现有 `src/engine/subtitle.ts` 的"抓 VTT → 重建成双语 VTT → 替换 track.src"路线对 x.com 无效**（§2.2），也是全项目最脆弱的一段代码。正确做法是"**只读 cues、自己画字幕**"，永不碰 `video.src` / `track.src`，A/V 同步风险归零。
3. **x.com 的适配成本主要不在算法，在"选择器 + 生命周期"**。原版给 x.com 写了 41 个配置键（含 30 条 selectors、5 条 extraInlineSelectors、20 条 excludeSelectors、1 组正则黑名单），我们要有同等的规则表达能力，否则做不出来。

---

## 1. 需求拆解与前提

### 1.1 需求原话 → 可执行定义

| 用户原话 | 本文定义 | 覆盖范围 |
| --- | --- | --- |
| "检测并翻译 x.com 中的**文档中内容**" | x.com 页面上的**可读文本**：推文正文（含长推文）、X Articles 长文页、用户简介、悬浮卡、推荐用户描述、Grok 对话、通知/私信、卡片链接摘要 | 见 §4.2 选择器表 |
| "翻译 x.com 中视频的 **cc 字幕**文字" | 播放器 CC 轨道（人工字幕 / 自动生成字幕）→ 双语字幕层 | 见 §5 |

### 1.2 明确不做（沿用 `docs/实现方案.md` §1.2 的裁剪）

- **无字幕轨的视频不做 ASR**（原版靠官方云端 ASR，本地无法复刻）。x.com 上不少视频根本没有 CC 轨 → 这时给出"该视频无字幕轨"的轻提示，不做伪字幕。
- 不做登录态、不做账号相关接口、不做 Grok 私有接口。
- 不做"X 视频翻译成品导出/分享"（原版有 shareCardRule，我们裁掉）。

### 1.3 为什么这两个问题必须分开

| 维度 | 页面内容 | 视频字幕 |
| --- | --- | --- |
| 触发 | 用户 Alt+A / 悬浮球 / 自动翻译（按域名） | 播放器出现 + CC 轨存在（或用户点播放器上的"译"按钮） |
| 数据源 | `document.querySelectorAll(规则选择器)` | `video.textTracks`（+ 极端情况下 hook `.vtt` 网络） |
| 更新频率 | 每次滚动/渲染（秒级、成批） | 每 1–3 秒一条 cue（单条、低延迟） |
| 渲染位置 | 段落末尾追加 `<span>` | 视频上层绝对定位浮层（或原生 `::cue`） |
| 失败模式 | 选择器失效 → 全站不翻（好排查） | 轨道被站点关闭/重建 → 字幕消失（要状态机兜底） |
| 复用 | 用通用 `Collector/Scheduler/Renderer` | 用独立 `SubtitleSession`，不复用页面调度器 |

---

## 2. 现状与差距（本仓库代码级实测）

### 2.1 页面内容：命中为 0

`src/engine/walker.ts:10` 的候选集是写死的：

```ts
const BLOCK_SELECTOR = 'p, h1, h2, h3, h4, h5, h6, li, blockquote, dd, dt, td, th, figcaption, summary';
```

再看 x.com 真实结构（推文正文）：

```html
<div data-testid="tweetText" dir="auto" class="css-146c3p1 r-8akbws ...">
  <span class="css-1jxf684 r-bcqeeo ...">这是一段</span>
  <span class="css-1jxf684 r-bcqeeo ...">推文</span>
  <a href="/hashtag/xxx"><span>#xxx</span></a>
  ...
</div>
```

于是：

| 差距 | 代码证据 | x.com 上的后果 |
| --- | --- | --- |
| 候选集不含 `div[data-testid=tweetText]` | `walker.ts:10` | 推文 100% 不进入翻译队列 |
| 推文正文被拆成多个 `span`（实体/链接分片） | x.com DOM | 即便命中，逐个 `span` 翻会把一句话切成碎片，译文语序全错 |
| 无站点规则层 | `src/core/` 下**没有** `rules/` 目录（`实现方案.md §4.2` 计划过但未落地） | 无法按站点覆写选择器/阈值/排除项 |
| 无 SPA 路由监听 | `pushState`/`popstate` 全仓库 0 处 | 点开推文详情/返回后新内容永不翻译 |
| 无内容 MutationObserver | 仅 `subtitle.ts` 与悬浮球用 | 无限滚动加载的推文永不翻译（只靠一次性 IntersectionObserver 观察首屏元素） |
| 无虚拟列表感知 | — | X 会复用 DOM 节点，译文 wrapper 可能"串"到另一条推文 |
| 无样式压制 | — | 长推文 `-webkit-line-clamp` 截断 → 译文被裁掉看不见 |
| 无"链接保持原文" | — | 用户名/话题/URL 会被翻掉（破坏可点击语义） |

### 2.2 视频字幕：现有实现路线与 x.com 不兼容

`src/engine/subtitle.ts` 的流程（124 行）：

```
scan <video> → 找 <track> → fetch(track.src) 拿整份 VTT → 解析 cue → 全量翻译
→ 重建双语 VTT → Blob URL → track.src = blob → track.mode = 'showing'
```

逐条对 x.com 判死：

| # | 现有假设 | x.com 实际 | 后果 |
| --- | --- | --- | --- |
| 1 | 字幕以 `<track>` 元素挂在 video 上 | 播放器用 `video.addTextTrack()` / HLS 字幕渲染项创建 **TextTrack 对象**，DOM 里常常没有 `<track>` | `querySelectorAll('track')` 查不到 → 完全不触发 |
| 2 | `track.src` 是完整 VTT 文件 | 轨道 cues 由播放器增量灌入（HLS 分片），可能没有独立 src | 拿不到 URL |
| 3 | 一次性全量翻译 | 字幕随播放持续产生；长视频/直播无限 | 首条字幕延迟极大；直播永不结束 |
| 4 | 换掉 `track.src` 重建 | 播放器在 SPA 中反复重建 video/track；换 src 会与播放器内部状态冲突 | 字幕消失、时间轴错位 |
| 5 | 只扫一次（DOMContentLoaded） | 打开视频弹层后才创建 video | 永不生效 |

结论：**这段代码不是"需要优化"，是"需要换路线"**。新路线见 §5。

---

## 3. 参考实现逆向结论（沉浸式翻译 v1.34.4）

> 复核方式：`default_config.json` 用 Node 解 JSON 后取 `rules[22]`；`content_main.js` 为单行 4.3MB bundle，用 `IndexOf` + 定长 `Substring` 取片段（禁止全量读）。

### 3.1 x.com 站点规则：`rules[22]`，id = `twitter`，41 个键

提炼成"我们要有什么表达能力"（右侧列 = 本方案对应设计）：

| 原版权限键 | 作用 | 本方案落点 |
| --- | --- | --- |
| `selectors`（30 条） | 显式段落选择器（优先于启发式） | `SiteRule.selectors` |
| `extraBlockSelectors.add` | 追加"块级段落"选择器 | `SiteRule.extraBlockSelectors` |
| `extraInlineSelectors`（5 条） | 把内部 `span/div` 当**行内**合并，整句翻译 | `SiteRule.inlineSelectors` |
| `additionalExcludeSelectors.add`（20 条） | 不翻区域（用户名/侧栏/菜单/播放器/Grok 图标…） | `SiteRule.excludeSelectors` |
| `excludeSelectorsRegexes.add` | `[data-testid=tweetText] span` 中匹配 `^[0-9a-zA-Z]{30,}$` 的跳过（钱包地址/长哈希） | `SiteRule.excludeTextPatterns` |
| `additionalStayOriginalSelectors`（6 条） | 链接文本保持原文（`tweetText a` 等） | `SiteRule.stayOriginalSelectors` |
| `likePreSelectors` | 预选整块（`[data-testid=tweetText]` 及其所有后代）→ 整段翻译 | `SiteRule.preSelectors` |
| `injectedCss.add`（7 条） | 解除 `-webkit-line-clamp`、放宽 Grok 面板高度、图片 object-fit 修正 | `SiteRule.injectedCss` |
| `paragraphMinTextCount: 2` / `MinWordCount: 1` | 段落阈值（比全局更松） | `SiteRule.minChars / minWords` |
| `mutationConfig.consumeTimeout: 1000` | X DOM 抖动剧烈 → Mutation 消费节流 1s | `SiteRule.mutationDebounceMs` |
| `visibleObserverScreens: [0,0,0,0]` | 只翻视口内（不留预载屏） | `SiteRule.visibleOnly` |
| `isTranslateTitle: false` | **不翻 document.title**（X 标题恒为 "Home / X"） | `SiteRule.translateTitle` |
| `ignoreZhCNandZhTW: true` | 中文段落不翻 | 已有 `isSameTargetLang` 覆盖 |
| `bodyRule.add.enable: false` | 不启用"正文主体"启发式 | `SiteRule.disableBodyHeuristic` |
| `advanceMergeConfig` | 条件覆写（移动端 / 仅译文模式） | 可延后（P3） |
| `darkModeRule` | 暗色判定（`html[style*=color-scheme: dark]`） | 复用给字幕/译文主题 |
| `observeUrlChange: false` + `switchTranslateRestart: true` | URL 变化**不强制重启**（X 弹层导航会改 URL 但保留时间线） | `RouteWatcher` 采用"软重扫"策略（§4.4） |

**关键 selectors 清单（x.com 语义化 `data-testid` 为主，混淆 class 为辅）**：

```
[data-testid='tweetText']                             推文正文
[data-testid='twitterArticleReadView']                X Articles 长文阅读视图
article h1, article .x-article-body                   长文标题/正文
[data-testid='longformRichTextComponent']             长推文富文本（.longform-unstyled span[data-text]）
[data-testid='UserDescription']                       个人简介
[data-testid='UserCell'] div:nth-child(2)             推荐用户描述
[data-testid='HoverCard'] div[dir=auto] / span[dir=auto]  悬浮资料卡
[data-testid='birdwatch-pivot'] div[dir=ltr]          Community Notes
[data-testid='card.layoutLarge|layoutSmall.detail'] > div:nth-child(2)   链接卡片摘要
[data-testid='inlinePrompt']                          时间线内提示卡
[data-testid='tweet'] .css-175oi2r span               兜底（混淆 class）
```
排除项（择要）：`header`、`[data-testid=sidebarColumn]`、`[role='tab']`、`[data-testid=User-Name]`、`[data-testid=socialContext]`、`[aria-label=Grok]`、`[data-testid=videoComponent]`、`.imt-caption-container *`、`[data-testid=tweet-text-show-more-link]`。

> ⚠️ **混淆 class 会变**。方案要求：语义 `data-testid` 为唯一"契约"，混淆 class 只作兜底且集中在一个文件里（`src/core/rules/sites/x.ts`），便于快速修。

### 3.2 字幕类型分类学（原版 `subtitleRule.type` 全量枚举）

从 `default_config.json` 统计（`"type":"xxx"` 出现在 `subtitleRule` 上下文）：

| 类型 | 条数 | 取字幕的方式 | 典型站点 |
| --- | --- | --- | --- |
| `subsrt` | 70 | hook 网络字幕文件（`subtitleUrlRegExp` + `hookType: fetch\|xhr`） | 大多数站点 |
| `webvtt` | 34 | hook `.vtt` 请求 | HBO Max、Kanopy |
| `text_track` | 23 | 读 `video.textTracks` 的 cues | WSJ 视频 |
| `text_track_dynamic` | 15 | 同上 + 轨道会动态重建 | Apple TV、CBC |
| `multi_attach_vtt` | 12 | 多语言 VTT（`multiSetting.urlLangRegex` 从 URL 提语言） | Khflix、wetv |
| `live_attach` | 4 | **字幕是 DOM 文本**（直播/会议），按容器 + textSelectors 读 | 百度网盘、Bloomberg |
| `youtube` | 7 | YouTube 专用（`tlang`、人工字幕优先、ASR 合并） | YouTube |
| `netflix` | 1 | Netflix timedtext（DRM 站点专用） | Netflix |
| **`twitter`** | **1** | **纯 TextTrack（`isInject:false`），无网络 hook** | **x.com / twitter.com** |

**这张表是本次方案的核心依据**：x.com 属于"不需要 hook 网络、直接读 TextTrack"那一类。原版给 x.com 甚至不加载注入脚本（`isInject: false`）。

### 3.3 x.com 字幕规则两代演进（必须都看）

**第一代（基础规则 `subtitleRule.add`）**：

```json
{ "type": "twitter", "isInject": false, "enableIOSFullScreenTextTrack": false,
  "videoPlayerSelector": "video",
  "enableTriggerTranslate": true,
  "loadingStyle": "bottom: unset; top: 5%;",
  "injectedCss": ["#layers[style='z-index: 1;'] [style='height: 100px;'] { height: 400px !important; }",
                   "video::cue {white-space: pre-line;}"],
  "liveSubtitleRule": { "containerSelector": ".r-13awgt0... > [role='listbox']",
                         "textSelectors": ["... [dir=\"ltr\"] > span"],
                         "mutationChangeDelay": 1000 } }
```
→ 用**原生 cues 渲染**（`video::cue`），双语字幕靠往 cue 文本里塞两行 + `white-space: pre-line` 换行。

**第二代（`subtitleRule.add_v.[1.17.3]`，实际生效）**：

```json
{ "multipleVideoContainerSelector": "[data-testid=\"videoComponent\"]",
  "videoSelector": "video",
  "attachRule": { "appendSelector": "video<-parent", "isDelay": true,
                  "injectedCSS": [".imt-caption-window {margin-bottom:0; bottom:2%; user-select:text;}",
                                  ".imt-caption-window {width:90%;}",
                                  ".imt-caption-container {z-index:unset;}"],
                  "injectedGlobalCSS": [
                    "[data-testid=\"videoComponent\"]:hover #immersive-translate-caption-window {bottom:60px;}",
                    "[data-testid=\"videoComponent\"]:focus-within #immersive-translate-caption-window {bottom:60px;}",
                    "[data-testid=\"modalContainer\"] #immersive-translate-caption-window {bottom:unset!important; height:180px!important;}"] },
  "quickButtonRules": [ { "appendSelector": "button[data-testid=\"captions\"]<-parent<-parent", ... },
                        { "appendSelector": "button[aria-label=\"Video Settings\"]<-parent<-parent<-parent", ... } ],
  "aiSubtitle": { "enable": true, "urlRegex": ["^https://(?:[^/]+\\.)?(?:x|twitter)\\.com/(?!i/broadcasts(?:/|$)).*$"] } }
```
→ **改为自绘浮层**（`attachRule`），原生轨道只当数据源。三个可直接抄的点：

1. `appendSelector: "video<-parent"` —— 浮层挂在 **video 的父元素**里。这一条同时解决 ①全屏（浮层必须在全屏元素子树内）②X 播放器自己的层叠上下文。
2. `hover/focus-within → bottom:60px` —— 鼠标移上去时控制条出现，字幕自动上移，不被控制条压住。
3. `button[data-testid="captions"]` —— **x.com 的 CC 开关按钮锚点**（也可反过来用它读用户是否开了 CC）。
4. `<-parent` 是原版自研的**祖先轴选择器 DSL**（`X←parent←parent`：从 X 往上两级）。我们 P3 再实现，P1 用普通 `querySelector` + `closest()` 顶替。

### 3.4 引擎机制（`content_main.js` 逆向，附偏移）

| 机制 | 位置 | 实现要点 | 我们抄不抄 |
| --- | --- | --- | --- |
| 自建 TextTrack 写入器 `M8(video, label, lang, cues, show)` | `@3936078` | `video.addTextTrack('subtitles', label, lang)`；打标 `createBy` / `isTranslated`；`mode = show ? 'showing' : 'hidden'`；`new VTTCue(startTime, endTime, text)` | **抄**（作 NativeTrack 备通道） |
| iOS 全屏专用会话 | `@3937500` | `webkitbeginfullscreen` 时把自己的 track 设 `showing`，同时把站点轨道全设 `hidden`（快照 + 还原） | 部分抄（全屏降级用） |
| 轨道接管主流程 | `@4137690` | `cuechange` → 取 `track.cues` → 语言检测 → 非目标语言：`attachSubtitle(items)` → **`track.mode='hidden'` + `isTranslated=true`** | **抄（核心）** |
| 双语字幕浮层组件 | `@3948500` | `div.imt-caption-container > div.imt-caption-window > div.imt-captions-text > [span.source-cue, span.target-cue]`；`dangerouslySetInnerHTML`；`translationPosition=top` 用 `flex-direction:column-reverse` | **抄结构** |
| 字号自适应 | `@3953000` 附近 `kdt` | `ResizeObserver(video)`：基准 = `min(width/45, height/24)`；容器过高时 `max(height/2.5, 14)`；下限 10px、无尺寸时 16px | **抄** |
| 位置拖拽 + 持久化 | `@3949000` | 拖 `imt-caption-window` 记 `topPercent/bottomPercent`；存 `subtitlePositions[hostname + cacheKeySuffix]`；>50% 用 bottom 锚点 | 抄（P3） |
| 字幕条目状态机 | `@3947000` | `item = {text, translation, state:'loading'|'translated'|'error', needReTranslate}`；批量翻译回调按 id 回填；失败写"翻译失败"占位 | **抄（核心）** |
| 字幕批量大小 | `YSe/Pdt` | 默认 `[1,3,5]` 递增；AI 增强模式按 `itemsPerRequestForSubtitle`（默认 8） | 抄（我们 8） |
| 直播/DOM 字幕通道 | `subtitleRule.liveSubtitleRule` | 容器 + `textSelectors` + `mutationChangeDelay:1000` | 抄（X 广播页要用） |
| 注入桥 `video-subtitle/inject.js` | 该文件仅 28KB | **只有 postMessage 封装，没有字幕逻辑** | ❌ 不抄（我们不需要 MAIN world） |

> **重要结论**：原版把字幕引擎放在内容脚本（隔离世界），因为它只需要 `video.textTracks`（DOM API，跨 world 可见）。我们项目文档 `实现方案.md §4.4` 里"video-subtitle 注入脚本必须 MAIN world"的说法对本场景**不成立**，只有 hook `fetch/XHR/m3u8` 时才需要 MAIN world。

### 3.5 原版「无字幕 ASR」是怎么做的：云端服务，**不是 ffmpeg**

对参考产物全部 bundle 做关键词普查（`content_main.js` 4.3MB / `background.js` 1.6MB / `offscreen.js` 1.2MB / 三个 `inject.js` / `aifw/` / `wasm/`）：

| 关键词 | 命中 | 判定 |
| --- | --- | --- |
| `ffmpeg` / `ffprobe` / `libav` | **仅 2 处，均在 `default_config.json` 的站点规则里**（`{"id":"ffmpeg","matches":"ffmpeg.org"}`） | 是**网站 ffmpeg.org** 的适配规则，与 ffmpeg 工具无关 |
| `MediaRecorder` / `captureStream` / `decodeAudioData` / `mp4box` / `muxer` / `remux` | **0** | 客户端**没有**抽音频/封装的本地管线 |
| `OfflineAudioContext` | 每个 bundle 2 处 | 目标是 `OfflineAudioContext \|\| webkitOfflineAudioContext` + 振荡器渲染 → **FingerprintJS 音频指纹**，与字幕无关 |
| `asr-audio/v2/subtitle?url=` / `asr-audio/v2/create-task` | `content_main.js` @4092805 / @4093206 | **官方云 ASR**：把**视频 URL** 提交成任务、查缓存、取回字幕 |
| `subtitles/yt-asr-subs` | `content_main.js` @4113190 | YouTube ASR 字幕的服务端合并端点 |
| `whisper` / `WhisperTokenizer` / `InferenceSession` / `onnxruntime` | `aifw/libner-*.js`（1.1MB）+ `wasm/ort-wasm-simd-threaded.wasm`（11MB） | 打包了 transformers.js 全套（含 Whisper 类），但**桌面插件字幕链路没调用它**；`aifw` 是 OneAIFW 占位符模块（本工程已裁剪） |

**结论**：原版「AI 字幕」= 把视频 URL 交给**自家云端**做 ASR + 翻译，属 Pro/配额功能（`locales.json`：`AI_SUBTITLE_QUOTA_URL: /topup?type=asr`、`aiSubtitleLogin`、`error_modal_ai_subtitle`、免费额度文案）。客户端不解码音频、不生成视频、不调 ffmpeg。

对我们的三点含义：

1. 想复刻同一条路 → 需要**自建或接入第三方 ASR 服务**（成本、合规、隐私另议）。
2. 想纯本地 → 需要 Whisper ONNX **模型权重**（原版只带了 ORT wasm 与 tokenizer 代码，没带模型）+ 用 `MediaElementAudioSourceNode` 抓音轨，工程量大（模型 40–150MB、首次加载慢、CPU 占用高）。
3. 维持 §1.2 的裁剪：**只翻"已有字幕轨"，无轨给提示**。

---

## 4. 方案 A：x.com 页面内容检测与翻译

### 4.1 目标架构（在现有 P3 引擎上加三层）

```
                     ┌─────────────────────────────────────────┐
                     │  src/core/rules/  （新增·站点规则层）      │
                     │  types.ts  matcher.ts  sites/x.ts        │
                     └───────────────┬─────────────────────────┘
                                     │ match(location) → SiteRule | null
┌────────────────────────────────────┴────────────────────────────────┐
│ src/engine/  （改造）                                                 │
│                                                                      │
│  RouteWatcher ──┐                                                    │
│  (pushState/    ├──► ContentObserver ──► ParagraphCollector ──► Scheduler │
│   popstate)     │    (MutationObserver   (规则选择器 + 行内合并    (批/节流/去重) │
│                 │     + 1s 去抖)           + 排除 + 文本校验)         │
│  LazyObserver ──┘                                        │            │
│  (IntersectionObserver 可见性)                            ▼            │
│                                                    Renderer(改造)     │
│                                            wrapper + 样式压制 + 幂等    │
└──────────────────────────────────────────────────────────────────────┘
```

改造后 `content.ts` 的主链路从"一次性 collectParagraphs"变成**事件驱动的增量扫描**，但保留原有 Alt+A 开关语义。

### 4.2 规则层数据结构（`src/core/rules/types.ts`）

```ts
export interface SiteRule {
  id: string;
  /** 匹配 host（支持 *.example.com）与 path（支持 glob） */
  matches: string[];
  excludeMatches?: string[];

  /* —— 段落识别 —— */
  selectors?: string[];            // 显式段落（优先）
  extraBlockSelectors?: string[];  // 追加块级
  inlineSelectors?: string[];      // 内部视为行内 → 合并整句（X 的 span 必须）
  preSelectors?: string[];         // 预选整块（likePreSelectors 语义）
  excludeSelectors?: string[];     // 永不翻译的区域
  excludeTextPatterns?: Record<string, string[]>; // 选择器 → 文本黑名单正则
  stayOriginalSelectors?: string[]; // 链接/用户名保持原文
  minChars?: number;
  minWords?: number;

  /* —— 生命周期 —— */
  mutationDebounceMs?: number;     // X: 1000
  visibleOnly?: boolean;           // X: true（visibleObserverScreens 0/0/0/0）
  observeUrlChange?: boolean;      // X: false（不强制重启）
  translateTitle?: boolean;        // X: false

  /* —— 呈现 —— */
  injectedCss?: string[];
  darkModeSelector?: string;
  subtitle?: SubtitleSiteRule;     // 见 §5
}
```

`matcher.ts`：`matchSiteRule(url)` → 最长匹配 + 首条命中；单测覆盖 `x.com`、`mobile.x.com`、`platform.x.com/embed*`、`x.com/settings*`（排除）、`x.com/jobs/*`（排除）。

### 4.3 x.com 规则实例（`src/core/rules/sites/x.ts` 摘录）

```ts
export const X_RULE: SiteRule = {
  id: 'x',
  matches: ['x.com', 'www.x.com', 'mobile.x.com', 'pro.x.com', 'twitter.com', 'mobile.twitter.com', 'platform.x.com/embed*'],
  excludeMatches: ['x.com/settings*', 'x.com/jobs/*', 'x.com/*/tos*', 'x.com/*/privacy*',
                   'x.com/account/access*', 'x.com/i/premium_sign_up', 'x.com/i/chat*'],
  selectors: [
    "[data-testid='tweetText']",
    "[data-testid='twitterArticleReadView']",
    'article h1', 'article .x-article-body',
    "[data-testid='longformRichTextComponent']",
    "[data-testid='UserDescription']",
    "[data-testid='HoverCard'] div[dir=auto]",
    "[data-testid='birdwatch-pivot'] div[dir=ltr]",
    "[data-testid='card.layoutLarge.detail'] > div:nth-child(2)",
    "[data-testid='card.layoutSmall.detail'] > div:nth-child(2)",
    "[data-testid='UserCell'] > div > div:nth-child(2)",
    "[data-testid='inlinePrompt']",
  ],
  inlineSelectors: [
    "[data-testid='tweetText'] span",
    "[data-testid='tweetText'] div",
    "[data-testid='UserDescription'] div",
    "[data-testid='HoverCard'] div[dir=auto] div",
  ],
  excludeSelectors: [
    'header', "[data-testid='sidebarColumn']", "[role='tab']", 'h2[role=heading]',
    "[data-testid='User-Name']", "[data-testid='socialContext']",
    "[data-testid='videoComponent']", "[data-testid='tweet-text-show-more-link']",
    "[aria-label='Grok']", "[data-testid='hoverCardParent'] [role=menuitem]",
    '.imt-caption-container *', '.imt-x-target-wrapper',
  ],
  excludeTextPatterns: { "[data-testid='tweetText'] span": ['^[0-9a-zA-Z]{30,}$'] },
  stayOriginalSelectors: ["[data-testid='tweetText'] a", "[data-testid='UserDescription'] a",
                          "[data-testid='HoverCard'] a", "[data-testid='UserCell'] a"],
  minChars: 2, minWords: 1,
  mutationDebounceMs: 1000,
  visibleOnly: true,
  observeUrlChange: false,
  translateTitle: false,
  injectedCss: [
    "[data-testid='tweetText'],[style*='-webkit-line-clamp'] {-webkit-line-clamp: unset !important;}",
    "[role=dialog] [style*='webkit-line-clamp'] {-webkit-line-clamp: unset !important;}",
    "[data-testid='card.layoutLarge.detail'] > div:nth-child(2) {-webkit-line-clamp: unset!important;}",
    "[data-testid='card.layoutSmall.detail'] > div:nth-child(2) {-webkit-line-clamp: unset!important;}",
    '.r-h9hxbl { width: unset; }',
  ],
  darkModeSelector: "html[style*='color-scheme: dark']",
  subtitle: X_SUBTITLE_RULE, // §5
};
```

### 4.4 段落识别算法（`ParagraphCollector`）

五步，顺序不可换：

```
1) 候选 = rule.selectors ∪ rule.extraBlockSelectors（有序，去重）
   —— 未命中规则时退回现有 BLOCK_SELECTOR 启发式（保持其它站点行为不变）

2) 过滤：
   a. el.closest(rule.excludeSelectors ∪ SKIP_ANCESTOR) → 跳过
   b. el.matches(rule.excludeTextPatterns 的选择器) 且 文本命中黑名单 → 跳过
   c. rule.visibleOnly && !inViewport(el, rootMargin) → 跳过
   d. 已有有效 wrapper（见 4.5 幂等校验）→ 跳过
   e. 文本 < minChars / 无字母数字 / 与目标语言相同 → 跳过

3) 行内合并（关键）：
   if (el.matchesRule(inlineSelectors) 的父级是 selectors 命中的段落) → 不单独成段
   实现：collector 按 selectors 顺序扫，命中段落 X 后：
     X 内部命中的 inlineSelectors 元素全部「吸收」进 X 的待译文本，
     不为其单独创建 paragraph（避免一句话被 span 切碎）

4) 文本提取：优先 el.innerText（保留视觉换行）→ normalizeText；
   stayOriginalSelectors 内的文本用「占位符保护」：
     提取时把 <a> 文本替换为 ${0},${1}…（写入 data-imt-ph 映射），
     译文回来后按序还原成 <a> 原文本（不可还原则整段回退原文，宁可不翻也不破坏链接）

5) 去重 + 排序：按 fnv1a(normalizedText) 去重（同页同文只翻一次），
   按 selectors 顺序 + DOM 顺序排序，交给 Scheduler 分批（8/批）
```

> **为什么必须做行内合并**：`[data-testid=tweetText]` 里 "I love <a>#AI</a> and <a>@jack</a>." 被拆成 5 个 span。逐 span 翻 = 5 次请求 + 语序崩坏 + 缓存命中率极低。

### 4.5 SPA / 虚拟列表生命周期（x.com 成败点）

x.com 的四个"反人类"特性与对策：

| 特性 | 现象 | 对策 |
| --- | --- | --- |
| **虚拟列表复用节点** | 滚动时 DOM 节点被复用给另一条推文 | **译文指纹校验**：wrapper 上存 `data-imt-src=fnv1a(原文)`；扫描时若 `fnv1a(当前原文) !== wrapper 指纹` → 删除旧 wrapper 并重新收集。这是防"译文串条"的唯一可靠手段 |
| **无限滚动** | 新 `cellInnerDiv` 不断插入 | `MutationObserver(document.body, {childList,subtree})` → 1s 去抖 → 只扫新增子树（`addedNodes`）→ 增量收集 |
| **弹层导航改 URL** | 打开推文详情/图片查看器，URL 变了但时间线还在 | `RouteWatcher` 监听 `pushState/replaceState/popstate`：URL 变化 → **软重扫**（不删已有译文，只补扫新区域）；仅当"页面类型"变化（如 `/home` → `/i/status/xxx` 全屏页）才考虑清理 |
| **React 重渲染吞节点** | 点赞/展开/翻译按钮点击后，推文容器可能整体重建 | Observer 自动兜底；wrapper 是追加节点，React 重建时被丢弃 → 下次扫描自动重翻（缓存命中，零成本） |

`RouteWatcher` 实现要点：`document_start` 时用 `Object.defineProperty` 或直接覆写 `history.pushState/replaceState` 打补丁（content script 无法监听 X 内部调用 `pushState`，必须 hook 后 dispatch 自定义事件），并 `popstate`。

### 4.6 渲染与样式压制（`Renderer` 改造）

现有 `renderer.ts` 只创建 `span.${WRAPPER_CLASS}`，对 x.com 不够，需要三点改造：

1. **块级呈现**：推文正文是块容器，译文必须是独立一行。
   ```css
   [data-testid='tweetText'] .imt-rebuild-target-wrapper,
   [data-testid='UserDescription'] .imt-rebuild-target-wrapper,
   article .x-article-body .imt-rebuild-target-wrapper { display: block; margin-top: 2px; }
   ```
2. **暗色主题适配**：用 `darkModeSelector` 判定，译文主题变量跟随（X 暗色背景 #000/#15202b，默认黑字会看不见）。
3. **不破坏 X 的 flex 布局**：x.com 大量使用 `css-175oi2r`（`display:flex; flex-direction:column`）。追加 `span` 作为 flex item 时要注意 `align-self`；`loading` 占位同理。必须实测 3 种场景：单条推文、引用推文（`div[role=link]` 内嵌）、长文正文。

另外两条硬规则：

- **只追加，不改写**：绝不 `el.textContent = 译文`（会摧毁 X 的事件委托与无障碍树，尤其 `role=link` 的整卡可点击）。
- **不翻译我们自己的产物**：`excludeSelectors` 里必须包含 `.imt-caption-container *`、`.imt-x-target-wrapper`、悬浮球，否则会出现"译文的译文"。

### 4.7 性能预算与限流

| 指标 | 目标 | 手段 |
| --- | --- | --- |
| MutationObserver 回调 | ≤ 1 次/秒 | 去抖 1000ms + 只处理 `addedNodes` |
| 首屏翻译出首条译文 | < 1.5s（免费通道）/ < 4s（AI） | 分批 8 段、首屏只收集视口内 |
| 单页面翻译请求数 | ≤ 段落数/8 + 滚动增量 | 文本级去重 + background 缓存（已有 `TranslateCache`） |
| 已译节点重扫成本 | O(1) | wrapper 指纹 + `isTranslated()` 短路 |
| 滚动流畅度 | 无长任务 > 50ms | 收集与渲染分离（`requestIdleCallback` 批量插入） |

---

## 5. 方案 B：x.com 视频 CC 字幕检测与翻译

### 5.1 探测（Detection）：先确认"字幕从哪来"

**任何实现之前先做这一步实测**（30 秒，x.com 任意带 CC 的视频页，播放器先点开 CC，然后在 DevTools Console 执行）：

```js
// ① 轨道清单
document.querySelectorAll('video').forEach((v, i) => {
  console.log(`[video ${i}]`, v.currentSrc?.slice(0, 80),
    [...v.textTracks].map(t => ({
      kind: t.kind, label: t.label, lang: t.language, mode: t.mode,
      cues: t.cues ? t.cues.length : null,
      first: t.cues?.[0]?.text?.slice(0, 60),
    })));
});
// ② 是否有 <track> 元素
console.log('track 元素数:', document.querySelectorAll('video track').length);
// ③ CC 按钮锚点
console.log('CC 按钮:', document.querySelector('button[data-testid="captions"]'));
```

判据：

| 观测结果 | 说明 | 走哪条通道 |
| --- | --- | --- |
| `textTracks` 有 1+ 条且 `cues` 非空 | 标准 TextTrack（**高概率，见 §3.3 依据**） | 主通道：TextTrack 接管 |
| `textTracks` 为空、`track` 元素为 0、但点 CC 后有字幕 | 播放器自绘字幕（DOM）或 WebCodecs 渲染 | 备通道：`liveSubtitleRule` 式 DOM 字幕读取 |
| 点 CC 后才有 cues | 轨道默认 `disabled`，需我们主动设 `hidden` 激活 | §5.2 的"主动激活" |

> 三种情况我们都覆盖（主/备通道 + 激活逻辑），所以这一步只是决定**默认优先级**，不阻塞开发。

### 5.2 接管（Takeover）：一个 `mode` 值决定成败

WebVTT/TextTrack 的 `mode` 语义必须记牢：

| mode | cues 是否加载 | `cuechange` 是否触发 | 浏览器是否绘制 |
| --- | --- | --- | --- |
| `disabled` | ❌ 可能被清空 | ❌ | ❌ |
| `hidden` | ✅ | ✅ | ❌ |
| `showing` | ✅ | ✅ | ✅（原生 `::cue`） |

**所以接管姿势固定为：`track.mode = 'hidden'`** —— 既保留 cues 与事件（我们拿得到数据），又让浏览器不再画（避免双份字幕）。

```ts
// 核心接管（示意）
function takeOver(video: HTMLVideoElement, pick: (t: TextTrack) => boolean) {
  for (const t of video.textTracks) {
    if (t.createBy === MARK || !pick(t)) continue;
    if (t.mode === 'disabled') t.mode = 'hidden';   // 主动激活（用户没点 CC 也能预翻译）
    else t.mode = 'hidden';                          // showing → hidden（抑制原生绘制）
    t.addEventListener('cuechange', onCueChange);
  }
}
```

坑位清单（每条都踩过才写）：

1. **`disabled → hidden` 不保证立刻有 cues**：HLS 分片可能只给了窗口内几秒。要容忍 `cues === null`，用 `addtrack` + 轮询（500ms，限 60s）兜底。
2. **轨道会被重建**：X 打开新视频/切清晰度会换 video 元素。用 `WeakMap<video, Session>` + MutationObserver 侦测新 video。
3. **同一页面多个 video**：时间线里有多个自动播放静音视频。**只接管"当前正在被观看"的那个**（判据：在 `[role=dialog]`/`[data-testid=modalContainer]` 内，或 `!video.muted && !video.paused`，或用户点了我们的按钮）。
4. **用户关 CC**：读 `button[data-testid="captions"]` 的 `aria-pressed`；变为 `false` 时停止接管并移除浮层（原版同逻辑 `removeAttachSubtitleWithUserClose`）。
5. **`hidden` 会触发站点自己的逻辑**：极少数播放器把 `mode==='showing'` 当"CC 已开"状态显示。若实测 X 的 CC 图标状态异常，改为"先保留 showing，用 CSS 隐藏原生 cue"：`video::cue { opacity: 0 !important; }`（次优解，保留在备选）。

### 5.3 翻译管线（`CueTranslator`）

数据结构与原版对齐（`@3947000`）：

```ts
interface SubtitleItem {
  id: number;
  start: number; end: number;          // 秒
  text: string;                        // 原文（已 strip HTML 标签，保留换行）
  translation: string;                 // 译文
  state: 'pending' | 'loading' | 'translated' | 'error';
}
```

流程：

```
cuechange
  → activeCues → (start,end,text) → 文本去重 → 命中 items 直接复用
  → 未命中：items.push({state:'pending'})，立即渲染「原文 + 翻译中…」
  → 入队（优先级：当前 cue > 后续 12 条 > 其余）
  → 批 8 条 → translateTexts(texts, from=cueLang, to=target, service=subtitle.service, scope='subtitle')
  → 回填 items，按 id 更新浮层（只更新可见 cue）
```

四条工程约束：

1. **不要一次性翻整轨**（现有实现的病）：长视频 300 条 cue × 8 = 38 次请求，首条字幕要等半分钟。
2. **预翻译窗口**：当前时间点 +12 条 cue 低优先级预翻（滚动窗口），边走边翻，用户几乎无等待。
3. **`focusDialogue`（原版"字幕专注于对话内容"）**：剔除 `（掌声）（音乐）` 类环境声标注——`/^[（(\[【].*[）)\]】]$/` 且无字母数字的 cue 直接跳过。
4. **失败降级**：翻译失败的 cue 显示原文单行（不显示"翻译失败"占满屏幕），并在浮层角落记一次错误计数；连续 3 次失败 → 自动切换到备用服务（`subtitle.service === 'inherit'` 时用 `general.service` 兜底链）。

### 5.4 渲染双通道

#### 通道 1：OverlayChannel（x.com 默认，抄 `attachRule`）

```html
<!-- 挂在 video.parentElement 内（原版 appendSelector: "video<-parent"） -->
<div class="imt-x-caption-container">
  <div class="imt-x-caption-window">           <!-- absolute; left:50%; transform:translateX(-50%); bottom:2% -->
    <div class="imt-x-captions-text">          <!-- display:flex; flex-direction:column; gap:2px -->
      <span class="imt-x-source-cue">原文</span>   <!-- white-space: pre-line -->
      <span class="imt-x-target-cue">译文</span>   <!-- 或 仅译文模式隐藏 source -->
    </div>
  </div>
</div>
```

关键样式（对应原版注入的 3 条 CSS + 我们补充的 2 条）：

```css
.imt-x-caption-container { position: absolute; inset: 0; pointer-events: none; z-index: 3; }
.imt-x-caption-window  { position: absolute; left: 50%; transform: translateX(-50%); bottom: 2%;
                         width: 90%; max-width: 90%; pointer-events: auto; user-select: text; }
[data-testid="videoComponent"]:hover .imt-x-caption-window,
[data-testid="videoComponent"]:focus-within .imt-x-caption-window { bottom: 60px; }  /* 让开控制条 */
.imt-x-source-cue, .imt-x-target-cue { white-space: pre-line; text-align: center;
                                      padding: 0 6px; border-radius: 4px;
                                      background: rgba(0,0,0,.75); color: #fff; }   /* 默认样式，可配 */
```

字号自适应（抄原版算法）：`ResizeObserver(video)` → 基准 `base = min(w/45, h/24)`；下限 `floor = 10`，若容器竖长（`h > 14 && h > w*2`）则 `floor = max(h/2.5, 14)`；最终 `fontSize = max(base, floor)`，容器无尺寸（0×0）时取 16px。

必须处理的边界：

| 场景 | 处理 |
| --- | --- |
| 全屏（原生 `requestFullscreen` 或 X 自绘容器） | 浮层在 `video.parentElement` 内 → 自动跟随；同时监听 `fullscreenchange` 重算字号 |
| iOS 全屏（`webkitbeginfullscreen`） | 浮层不可见 → 切 **NativeTrackChannel**（原版 `enableIOSFullScreenTextTrack` 就是干这个） |
| 画中画（PiP） | 浮层不可见 → 接受"无字幕"或降级原生轨道；给设置项说明 |
| 弹层（图片/视频查看器） | `[data-testid="modalContainer"]` 内高度受限 → 原版给 `height:180px`；我们按容器高度自适应 |
| 裸 `<video>`（无 `[data-testid=videoComponent]`） | 兜底挂到 `video.parentElement`，若父元素无定位则给 `position:relative`（注意：会给站点 DOM 加内联样式，需可逆） |
| 多个 video 同时存在 | 每个 video 独立 Session，但只允许 1 个"活跃浮层"（用户切换时销毁旧的） |

#### 通道 2：NativeTrackChannel（降级 / iOS 全屏）

```ts
// 抄原版 M8(@3936078)
const MARK = Symbol.for('imt-x-track');
function writeNativeTrack(video: HTMLVideoElement, label: string, lang: string, cues: SubtitleItem[]) {
  let t = [...video.textTracks].find(x => (x as any).createBy === MARK);
  if (!t) { t = video.addTextTrack('subtitles', label, lang); (t as any).createBy = MARK; }
  else { while (t.cues?.length) t.removeCue(t.cues[0]); }
  for (const c of cues) t.addCue(new VTTCue(c.start, c.end, `${c.text}\n${c.translation}`));
  t.mode = 'showing';
  // 必配 CSS：video::cue { white-space: pre-line; }  ← 原版 x.com 规则里就这一条
}
```
注意：原生通道样式能力极弱（只能 `::cue { color/background }`，且不能双语不同字号），所以只作降级。

### 5.5 播放器快捷入口（✅ 已实现，2026-11-09）

原版在播放器控制条插一个"译"按钮（`quickButtonRules`），x.com 锚点已给出：`button[data-testid="captions"]`（先祖轴）。但**当前渲染器没有 `data-testid`**（§10.7），因此本工程改为：

- **锚点链**：音量按钮（`aria-label*=静音/音量/mute/volume`、`.vjs-mute-control`、`.ytp-mute-button`）→ 兜底「设置/全屏/字幕」按钮所在簇的最左
- **浮层芯片**：`position:fixed` 的 "CC" 芯片跟随锚点位置（**不能直接插进控制条**：容器 `pointer-events:none` + 覆盖层会导致鼠标点不到，实测见 ASR 方案 §14.3）
- **面板**：Shadow DOM，含「此视频字幕」开关（有轨走轨道翻译、无轨起 ASR）、显示类型、译文位置、字幕样式、不再显示该快捷方式、更多功能

细节与验证见 [ASR字幕接入方案.md](./ASR字幕接入方案.md) §14.3。

### 5.6 X Live / 广播页（DOM 字幕通道）

X 的直播/广播页（`x.com/i/broadcasts/*`）字幕**不是 TextTrack，是 DOM 文本**：原版在这类 URL 上关掉了 AI 字幕（`aiSubtitle.urlRegex` 里带 `(?!i/broadcasts(?:/|$))` 负向断言），并另配了 `liveSubtitleRule`（`containerSelector` + `textSelectors`）专门处理——即直播字幕走的是"读 DOM 文本"这条独立通道。

设计一个通用 `DomCaptionSession`：

```ts
interface DomCaptionConfig {
  containerSelector: string;    // 例：'[role=listbox]' 容器
  textSelectors: string[];      // 例：'> div[dir=ltr] > span'
  mutationChangeDelay: number;  // 1000ms：直播流式文本，等稳定再翻
}
```
流程：MutationObserver 监听容器 → 提取当前完整字幕文本 → 与上次比较（相同则跳过）→ 翻译 → 渲染到浮层（复用 OverlayChannel）。原版对 `x.com/i/broadcasts` 是排除的（`aiSubtitle.urlRegex` 里有 `(?!i/broadcasts)`），说明它也走另一套。我们 P4 再做，优先保证普通视频。

### 5.7 没有字幕轨时的处理

- 播放器无 CC 按钮 / 点开无字幕 / `textTracks` 为空 → 显示一次性轻提示（右上角 toast，8s 自动消失）：**"该视频未提供字幕轨，暂无法生成双语字幕"**。
- 绝不做伪造字幕（原版靠云端 ASR，已裁剪）。
- 可选后续增强（不在本方案）：本地 Whisper WASM（`wasm/ort-wasm-simd-threaded.wasm` 原版就有 11MB ORT，但需要模型文件）——留作 P5+ 的技术储备，不在本期承诺。

### 5.8 字幕验收清单

- [ ] 有 CC 轨的视频：点 CC → 出现"原文 + 中文"两行，时间同步（连续 30s 无错行、无残留）
- [ ] 用户点 CC 关闭 → 浮层消失，不残留；再点 CC → 恢复（不重复请求，走缓存）
- [ ] 同一页面 3 个视频，切到第 2 个播放 → 只有它出字幕
- [ ] 全屏 → 字幕可见、字号随尺寸变化、控制条出现时上移 60px
- [ ] 退出全屏 → 恢复正常
- [ ] 拖动浮层 → 位置记住，刷新页面后仍在同一位置
- [ ] 静音自动播放的时间线视频 → 不打扰（无浮层）
- [ ] 直播（若做）→ 字幕延迟 < 3s，不闪烁

---

## 6. 代码落点与增量清单

### 6.1 新增文件

| 路径 | 职责 | 估算 |
| --- | --- | --- |
| `src/core/rules/types.ts` | `SiteRule` / `SubtitleSiteRule` 类型 | 80 行 |
| `src/core/rules/matcher.ts` | URL → 规则匹配（含 glob/排除） | 90 行 |
| `src/core/rules/sites/x.ts` | x.com 规则（选择器 + 样式 + 字幕） | 160 行 |
| `src/core/rules/index.ts` | 规则注册与查询 | 40 行 |
| `src/engine/spa/router.ts` | pushState/replaceState hook + 事件分发 | 70 行 |
| `src/engine/spa/contentObserver.ts` | MutationObserver 去抖 + 增量扫描调度 | 120 行 |
| `src/engine/collector.ts` | 规则驱动的段落收集（替换 walker 两函数的核心） | 220 行 |
| `src/engine/subtitle/detector.ts` | video/textTrack/DOM 字幕三路探测 | 150 行 |
| `src/engine/subtitle/session.ts` | 单 video 会话（接管/状态机/清场） | 200 行 |
| `src/engine/subtitle/translator.ts` | cue 批量 + 优先级 + 去重 + 降级 | 160 行 |
| `src/engine/subtitle/overlay.ts` | OverlayChannel（含字号/拖拽/全屏） | 240 行 |
| `src/engine/subtitle/nativeTrack.ts` | NativeTrackChannel（降级） | 80 行 |
| `src/engine/subtitle/domCaption.ts` | X Live DOM 字幕（P4） | 120 行 |
| `src/engine/subtitle.css` | 字幕浮层样式 | 120 行 |

### 6.2 改造文件

| 路径 | 改动 |
| --- | --- |
| `src/engine/walker.ts` | 抽成 `collector.ts` 的默认策略；保留导出签名给旧调用点（避免大范围改动） |
| `src/engine/renderer.ts` | 增加 wrapper 指纹（`data-imt-src`）、块级/行内两种呈现、暗色主题 |
| `src/engine/subtitle.ts` | **整体替换**为 `subtitle/index.ts`（对外仍导出 `initSubtitle/disposeSubtitle`，`content.ts` 零改动） |
| `src/entrypoints/content.ts` | 接入 `RouteWatcher` + `ContentObserver`；Alt+A 语义不变（关闭时清所有 wrapper + 停止 subtitle session） |
| `src/core/config/defaults.ts` | 新增 `subtitle.preTranslateWindow`、`subtitle.overlayStyle`、`subtitle.autoActivateTrack`、`siteRules.enabled` |
| `src/core/messaging/protocol.ts` | 新增 `subtitle:getItems`（下载字幕用，可选）、`subtitle:status` 事件 |
| `src/entrypoints/options/pages/Subtitle.vue` | 字幕设置加"浮层样式/预翻译窗口/自动激活轨道"三项 |

### 6.3 需要与 background 对齐的两点

1. `translate:batch` 的 `scope` 已支持 `'subtitle'`（`protocol.ts:13`），**无需改协议**；只需注意 subtitle 批量用 8（不是页面用的 24），避免长 prompt 拖慢单条延迟。
2. 缓存键已含 `service+from+to+text`（`cache.ts`），字幕天然受益——同一视频重复观看零请求；**预热**：预翻译窗口的 cue 结果自动落缓存。

---

## 7. 分阶段实施计划

| 阶段 | 内容 | 验收 | 估时 |
| --- | --- | --- | --- |
| **X1 规则层** | `core/rules/*` + collector 改造 + 单测（matcher/合并/排除） | 其它站点行为零回归（现有单测全绿）；x.com 首屏能翻出推文 | 0.5 天 |
| **X2 生命周期** | RouteWatcher + ContentObserver + wrapper 指纹 + 样式压制 | 无限滚动持续翻译；弹层导航不丢不串；长推文不截断 | 1 天 |
| **X3 字幕主通道** | detector + session（接管）+ translator + overlay | 有 CC 轨视频出双语字幕；关闭/重开正常；多视频隔离 | 1.5 天 |
| **X4 字幕打磨** | 全屏/字号/拖拽持久化/快捷按钮/PiP 降级 | §5.8 清单全绿 | 1 天 |
| **X5 直播 + 设置** | DomCaptionSession + 设置页三项 + 文档更新 | 广播页字幕可用（尽力）；设置即时生效 | 0.5 天 |

每个阶段结束：`pnpm test` + `pnpm build` 通过 → `chrome://extensions` 重载 → 按清单人工点验 → commit（`feat(x): …`）。

---

## 8. 风险与对策

| # | 风险 | 概率 | 影响 | 对策 |
| --- | --- | --- | --- | --- |
| R1 | X 混淆 class 改名 → 选择器失效 | 高（季度级） | 部分区域不翻 | 只用 `data-testid` 作契约；混淆 class 集中一处；提供「选择器自检脚本」（附录 B）快速定位 |
| **R1'** | **X 前端换代（2026 实测：新渲染器 0 个 `data-testid`、0 个旧混沌类名）** | **已发生** | **整站适配规则失效** | 选择器改为"结构+语义属性"双轨，并保留旧 `data-testid` 兼容；每次发版前跑附录 B3 巡检；规则文件按"渲染器版本"分组（§10.7） |
| R2 | X 视频字幕不走 TextTrack（走自绘/DOM） | 中 | 主通道失效 | 三路探测 + 备通道（DOM 字幕读取）已设计；§5.1 脚本 30 秒可判定 |
| R3 | `mode='hidden'` 与站点 CC 状态互相干扰 | 中 | CC 图标/字幕表现异常 | 备选：保留 `showing` + `video::cue{opacity:0}`；实测二选一 |
| R4 | 虚拟列表复用导致译文串条 | 高（若不做指纹） | 严重（用户体验崩） | wrapper 指纹校验（§4.5），必做 |
| R5 | 字幕翻译请求打爆限流 | 中 | 其它翻译排队 | 滚动窗口 + 8/批 + 缓存 + 独立 `scope='subtitle'` 可单独限流 |
| R6 | 免费通道（bing）字幕短句翻译质量差 | 中 | 字幕可读性差 | 字幕默认服务可独立配置（`subtitle.service`），文档引导选 AI |
| R7 | 全屏/画中画下浮层不可见 | 低 | 功能缺失 | NativeTrackChannel 降级 |
| R8 | 破坏 X 自身交互（点击/无障碍） | 低 | 站点不可用 | 只追加不改写；浮层 `pointer-events:none` + 仅窗口内 `auto` |

---

## 9. 附录

### A. 参考实现证据索引（可复核）

| 结论 | 证据位置 |
| --- | --- |
| x.com 站点规则 41 个键 | `default_config.json` → `rules[22]`（id=`twitter`） |
| 字幕类型全量枚举 | `default_config.json` 中 `subtitleRule` 上下文 `"type":"…"`；`manga` 160 条属图片规则干扰项 |
| x.com 字幕 = TextTrack，无需注入脚本 | `subtitleRule.add.type="twitter"`、`isInject:false`、无 `hookType/subtitleUrlRegExp` |
| 原生 cue 渲染证据 | `injectedCss: ["video::cue {white-space: pre-line;}"]` |
| 自绘浮层（二代） | `subtitleRule.add_v.[1.17.3].attachRule.appendSelector = "video<-parent"` |
| CC 按钮锚点 | `quickButtonRules[0].appendSelector = "button[data-testid=\"captions\"]<-parent<-parent"` |
| 自建 TextTrack 写入 | `content_main.js` @3936078 `M8(...)`（`addTextTrack` / `createBy` / `VTTCue`） |
| 轨道接管 + 隐藏原轨 | `content_main.js` @4137690 `handleTextTracks`（`o.mode="hidden"; o.isTranslated=true`） |
| 双语浮层 DOM 结构 | `content_main.js` @3948500 附近 `imt-caption-container/-window/-captions-text/source-cue/target-cue` |
| 字号自适应算法 | `content_main.js` `kdt`（`min(w/45,h/24)`、`max(h/2.5,14)`） |
| 位置拖拽 + 持久化 | `content_main.js` `iCe`（`subtitlePositions[hostname-cacheKeySuffix]`） |
| 字幕条目状态机 | `content_main.js` @3947000 `{text,translation,state,needReTranslate}` |
| iOS 全屏原生轨道会话 | `content_main.js` @3937500 `webkitbeginfullscreen` 快照/还原 |
| 字幕引擎不在注入脚本 | `video-subtitle/inject.js` 全文仅 postMessage 封装（28KB，无 cue 逻辑） |

### B. 实测脚本（复制到 DevTools Console）

**B1. x.com 页面内容自检**

```js
const sel = {
  tweetText: "[data-testid='tweetText']",
  article: "[data-testid='twitterArticleReadView']",
  bio: "[data-testid='UserDescription']",
  hover: "[data-testid='HoverCard'] div[dir=auto]",
  articleBody: 'article .x-article-body',
};
for (const [k, s] of Object.entries(sel)) {
  const els = [...document.querySelectorAll(s)];
  console.log(k, '命中', els.length, '可见', els.filter(e => e.getClientRects().length).length);
}
// 段落切碎程度：一个 tweetText 里有多少 span（>3 说明必须做行内合并）
const t = document.querySelector(sel.tweetText);
console.log('tweetText 内 span 数:', t?.querySelectorAll('span').length);
```

**B2. x.com 字幕自检**

```js
document.querySelectorAll('video').forEach((v, i) => {
  console.log(`[video ${i}]`, {
    src: v.currentSrc?.slice(0, 70), muted: v.muted, paused: v.paused,
    tracks: [...v.textTracks].map(t => ({
      kind: t.kind, lang: t.language, mode: t.mode,
      cues: t.cues?.length ?? null, sample: t.cues?.[0]?.text?.slice(0, 50),
    })),
  });
});
console.log('CC 按钮', document.querySelector('button[data-testid="captions"]')?.outerHTML?.slice(0, 200));
```

**B3. 选择器失效巡检**（发版前跑一次）

```js
// 输出 0 命中的规则选择器，快速定位 X 改版影响面
const must = ["[data-testid='tweetText']", "[data-testid='UserDescription']",
              "[data-testid='cellInnerDiv']", 'button[data-testid="captions"]'];
must.forEach(s => console.log(s, document.querySelectorAll(s).length));
```

### C. 与原版的能力差异声明（诚实清单）

| 能力 | 原版 v1.34.4 | 本方案 |
| --- | --- | --- |
| x.com 推文/长文/简介翻译 | ✅（41 键规则 + 801 条总规则） | ✅（单站规则，top 语义选择器） |
| 混淆 class 全覆盖兜底 | ✅（30 条 selectors，含大批混淆 class） | ⚠️ 只保留高频 + 语义项，长尾缺失（可后补） |
| 视频 CC 双语字幕 | ✅（浮层 + 原生 + iOS 全屏 + 直播 + AI 字幕） | ✅ 浮层 + 原生降级 + 直播（P4）；❌ AI 字幕（无 ASR） |
| 播放器"译"快捷按钮 | ✅ | ✅（P3，锚点依赖 `data-testid=captions`） |
| 字幕位置记忆/样式配置 | ✅（完整字幕主题系统） | ✅ 位置记忆 + 基础样式（不抄主题系统） |
| 无字幕轨 ASR | ✅（云端） | ❌ 已裁剪 |
| 字幕下载（srt/vtt） | ✅ | 可选（协议已预留 `subtitle:getItems`） |
| 分享卡片导出 | ✅（shareCardRule） | ❌ 裁剪 |

---

## 10. 实测记录（2026-11-09，CDP 驱动真实 Chrome）

> 本节是在方案落地前做的**真机验证**，用于校正 §2 的判断并锁定修复优先级。
> 环境：Chrome 157.0.8103.38 + 独立 profile（`--remote-debugging-port=9222`）+ 扩展 `.output/chrome-mv3`（v0.1.0 / 2026-11-04 构建）。

### 10.1 环境事实（影响今后的自动化验收）

- **Chrome 137+ 已忽略 `--load-extension`**（本次实测：加 `--disable-features=DisableLoadExtensionCommandLineSwitch` 仍不生效，SW 目标里只有 Chrome 自带组件扩展）。可行替代：把解压目录写进 profile 的 `extensions.settings`（`location: 4` / `state: 1`）后启动，或人工「加载已解压」一次。
- 验证脚本可复用：`.temp/cdp/*.mjs`（`cdp.mjs` 是极简 CDP 客户端；Node 24 内置 `WebSocket`）。

### 10.2 结果总表

| # | 测试项 | 结果 | 证据 |
| --- | --- | --- | --- |
| 1 | 扩展加载 / 内容脚本注入 | ✅ | `example.com` 出现 `.imt-rebuild-floatball-wrap` |
| 2 | 三条免费翻译通道 | ✅ 全部可用 | `translate:batch` 直测：bing 8479ms / transmart 365ms / google 1886ms，均返回「你好，世界」 |
| 3 | 普通网站双语翻译 | ✅ | Wikipedia 首屏 89 个 loading → 11.5s 出 16 条译文（其余仍在队列）；悬浮球 done |
| 4 | **x.com 页面内容翻译（默认配置）** | ❌ **0 段落** | `loading=0 / wrappers=0`，悬浮球保持 idle |
| 5 | x.com 强制 `html[lang]=en` 后 | ⚠️ 能出译文但不可用 | 5 条译文，全挂在整条 `<LI>` 上 |
| 6 | 字幕引擎（P8a，受控 `<track>` 页） | ✅ 可用 | 12s 后 `track.src` → `blob:`，3 条 cue 变双语 |
| 7 | x.com 视频 CC 字幕 | ⛔ 无法测 | 未登录页 `<video>`=0、`textTracks`=0 |

### 10.3 根因（按影响排序，均已定位到代码行）

| # | 根因 | 代码位置 | 证据 |
| --- | --- | --- | --- |
| R1 | **`sameLangCheck` 用 `html[lang]` 判整页语言**；x.com 的 `html lang="zh-cn"` 是**界面语言**（跟随账号/IP），于是整页在采集前直接 return | `content.ts:229` | 在同一页面执行 `document.documentElement.lang='en'` 后立刻出 5 条译文；改回即 0 条 |
| R2 | 段落候选集不含推文正文容器 | `walker.ts:10` | 实测候选 13 个（H1/H2/LI），**没有一条是推文正文**；正文 `div[data-testid="tweetText"]` 不存在于未登录页，登录后也不在候选集内 |
| R3 | 未登录 x.com 走 `entry-client-logged-out-*.js`，**全页 `data-testid` 数量 = 0**、无 `react-root` | x.com 站点侧 | `Object.keys(testid计数).length === 0`。→ 参考实现那套 `[data-testid=...]` 选择器**只在登录态生效**，方案 §4.2 的选择器表必须用登录态复核 |
| R4 | 无站点规则时退化为"整块 `<li>` 当一段" | `walker.ts:63` | 译文样例：`Jack @ jack shows the translation just setting up my twttr 4:50 22 March 2006 19000 130000 320000 25000`（用户名/时间/互动数全被翻，正文本身没翻） |

### 10.4 顺带发现的两个缺陷

| # | 缺陷 | 位置 | 影响 |
| --- | --- | --- | --- |
| B1 | `config:set` 把整个 `payload` 传给 `saveUserConfig`，而协议是 `{ patch }` | `background.ts:153`（应为 `msg.payload.patch`） | 实测：调用后 `userConfig` 顶层多出一个 `patch` 键、真实设置不生效。当前仓库内**无调用方**（设置页走 `ConfigStore → saveUserConfig`），属潜伏 bug；但任何未来用消息改配置的功能都会踩 |
| B2 | `walker.ts:76` 的段落级 `isSameTargetLang` 过滤**不受** `engine.sameLangCheck` 控制 | `walker.ts:76` | 开关只关掉整页判定，段落级仍会过滤。行为本身合理（中英混排只翻外文），但设置项语义与实现不一致，需在 UI 文案或代码里明确 |

### 10.5 对方案的影响（结论修正）

1. **R1 必须与 §4 的规则层一起修**：站点规则需要能覆写"整页语言判定"（`SiteRule.skipSameLangCheck: true`，或改成"按主内容区文本采样判语言"而非 `html[lang]`）。否则即使选择器全对，x.com 依然一条不翻。
2. **§4.2 的选择器表需登录态复核**，尤其"未登录页 0 个 `data-testid`"这一事实说明：不能靠未登录页做选择器回归。
3. **§5 的路线不变，但主/备通道仍未验证**（未登录页没有 video/textTrack）。登录态下第一件事就是跑附录 B2。
4. P8a 字幕引擎在 `<track>` 场景**是好的**（`blob:` 重建 + 双语 cue 都正常），不要因为 x.com 不适用就重写它；x.com 走 §5 的新通道，两者可并存（`text_track` 与 `overlay` 两种 session）。

### 10.6 待补测清单（需登录态）

- [ ] 登录后 x.com：`[data-testid=tweetText]` / `[data-testid=UserDescription]` / `[data-testid=twitterArticleReadView]` 命中数与可见性
- [ ] 带 CC 视频：`video.textTracks` 是否非空、`kind/label/language/mode/cues` 实测值（附录 B2）
- [ ] `button[data-testid="captions"]` 是否存在（快捷按钮锚点）
- [ ] 关闭/开启 CC 时 `mode` 与 `aria-pressed` 的变化

### 10.7 定点实测：`x.com/arim_011/status/2119640814595063969`（用户指定）

#### 结果

| 维度 | 实测值 | 结论 |
| --- | --- | --- |
| 页面翻译（**默认配置**） | `wrappers=0`，悬浮球 idle | ❌ 一条都没翻（R1 短路） |
| 页面翻译（绕过 R1：`sameLangCheck=false`） | `wrappers=1`，命中 `H1 < MAIN < DIV` | ❌ 翻的是**隐藏的 SEO 标题**（`position:absolute; width:1px; height:1px`），用户视觉上仍是 0 条 |
| 推文正文容器 | `SPAN < DIV(dir=auto).max-w-full.text-lead < DIV.flex.flex-col < DIV.@container/post-actions < ARTICLE.group/post` | 不在候选集内 → 正文永远不翻 |
| 视频 | `readyState=4`，可播放，`duration=21s` | ✅ 视频本身可播 |
| 视频字幕轨 | `textTracks=0`、`<track>=0`、`CC 按钮` 不存在 | ❌ 无轨可翻 |
| **HLS master playlist** | 只有 3 条 `TYPE=AUDIO` + 3 档 `#EXT-X-STREAM-INF`，**无 `TYPE=SUBTITLES`、无 `CLOSED-CAPTIONS`** | ❌❌ **源视频根本没有字幕轨**——不是登录问题、不是播放器问题，是媒体层面没有字幕 |
| 网络资源中的字幕请求 | `.vtt` 命中 = 0 | 同上 |

**这条帖子的最终判定**：页面文字默认不翻（R1+选择器）；视频（21s 赛后采访）**在 HLS 里就没有字幕渲染项**，任何"CC 字幕翻译"方案（包括原版）都无从下手，只能走 ASR——而已裁剪。

#### 🔴 重大发现：X 前端已换代，`data-testid` 不再是契约

在这个页面实测：

| 指标 | 值 |
| --- | --- |
| 元素总数 | 505 |
| 带 `data-testid` 的元素 | **0** |
| 旧版混沌类名（`css-xxxxxx` / `r-xxxx`） | **0** |
| 新版 Tailwind 风格类名 | 123（`mx-auto`、`max-w-[1280px]`、`pr-(--safe-area-right)`、`group/post`、`@container/post-actions`） |
| JS 入口 | `entry-client-logged-out-*.js` |

→ 参考实现（v1.34.4 / 2025）里那套 `[data-testid='tweetText']`、`.css-175oi2r`、`.r-h9hxbl` 选择器，**对当前渲染器全部失效**。方案 §4.2 的选择器表与 §8 的风险 R1 都要据此上调严重级别：

- `data-testid` **不能**作为唯一契约；需以"结构 + 语义属性"双轨（`article.group/post`、`[dir=auto]`、`[role=…]`、`.text-lead`、`lang` 属性等）+ 兜底启发式。
- 需要区分**登录/未登录两套渲染器**分别采集选择器（本次只采到未登录那套）。

### 10.8 由此产生的下一步（阻塞项）

1. **必须登录一次**才能确认登录态 DOM（`data-testid` 是否仍存在）与 CC 按钮/轨道。这是目前唯一无法绕过的阻塞。
2. **必须换一个真的带 CC 的视频帖子**才能验证字幕链路（本次这条 HLS 里没有字幕渲染项）。判断方法：播放器右下角出现 `CC` 按钮，或 `video.textTracks.length > 0`。
3. 修复优先级（按收益/成本）：R1（`sameLangCheck` 误判，1 行级）> x.com 规则层（选择器，需登录态复核）> 字幕通道（需带 CC 素材）。

### 10.9 修复与回归（2026-11-09 12:3x，已实机验证）

首次实现（对应 §7 的 X1 阶段的一部分）：

| 文件 | 改动 |
| --- | --- |
| `src/core/rules/types.ts` | `SiteRule` 类型（selectors / excludeSelectors / translateTitle / skipSameLangCheck / injectedCss…） |
| `src/core/rules/matcher.ts` | host / host+path / 通配 / excludeMatches 匹配 |
| `src/core/rules/sites/x.ts` | x.com 规则：**新旧两套渲染器选择器**、互动数/用户名/时间排除、`translateTitle:false`、`skipSameLangCheck:true` |
| `src/engine/walker.ts` | 规则驱动候选集 + 祖先去重 + 规则排除 + **尺寸退化元素过滤**（干掉 1px 的 SEO 隐藏 h1）+ 段落级同语言过滤改由 `engine.sameLangCheck` 控制 |
| `src/entrypoints/content.ts` | 删除 `html[lang]` 整页判定（R1）；标题翻译受规则约束；注入规则 CSS |
| `src/engine/content.css` | x.com 译文 `display:block`，独立成行 |
| `src/entrypoints/background.ts` | `config:set` 改为取 `payload.patch`（B1） |

验证（**同一条帖子 + 默认配置**，无任何手工开关，`userConfig` 已重置）：

| 指标 | 修复前 | 修复后 |
| --- | --- | --- |
| 译文条数 | 0 | **1（正文）** |
| 命中元素 | 隐藏 `H1`（1px，用户看不见） | `DIV[dir=auto].max-w-full.text-lead`，`display:block` |
| 译文 | — | `#Faker：我觉得今年我们可以做得更好的事情有很多，我真的想向我们的球迷展示更好的一面，回来时更加坚强！🍀🍀🍀🍀🍀` |
| 页面标题 | 被翻（无意义） | 未翻（规则 `translateTitle:false`） |

回归：Wikipedia 88 条译文 / example.com 5 条译文；`vitest` 53/53 通过；`vue-tsc` 0 错误；`wxt build` 通过。

仍未解决（同一帖子）：

- **视频无 CC**（§10.7：HLS 里没有字幕渲染项）→ 字幕链路无从验证。
- **无 MutationObserver / 路由监听**：向下滚动新加载的推文仍需再点一次翻译（属 §7 的 X2 阶段）。
- 推文正文若被 line-clamp 截断，需依赖 `injectedCss` 解除（已带，但新渲染器的截断类名待登录态实测补全）。

---

*方案版本 v1.3 · 2026-11-09 · 结论基于 v1.34.4 编译产物逆向（文件 + 偏移见附录 A）、本仓库源码实测、真机 CDP 验证（§10）与 HLS 清单抓取（§10.7），非推测*
