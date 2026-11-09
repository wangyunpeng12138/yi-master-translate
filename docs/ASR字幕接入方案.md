# 无字幕视频 ASR 接入方案：本地 Whisper + 云 API（可配置）

> **文档定位**：字幕专项的第二个技术方案，补齐 [`x-com-适配方案.md`](./x-com-适配方案.md) §1.2 里被裁剪的「无字幕 ASR」。
> **前置事实**（已真机取证）：x.com 的 `arim_011/status/2119640814595063969` 那条视频，HLS master playlist 里**没有任何 `TYPE=SUBTITLES` / `CLOSED-CAPTIONS`** —— 源视频无字幕轨，`textTracks` 恒为 0。
> **参考实现的做法**：不是本地 ffmpeg，而是把**视频 URL 交给官方云端**做 ASR（`asr-audio/v2/create-task`），Pro/配额功能。详见 x-com 方案 §3.5。
> **本方案目标**：把"音频 → 字幕"做成**可插拔的 provider**（本地 Whisper 为默认、云 API 可选），并让接入点**全部可配置**。
> 写作日期：2026-11-09

---

## 0. 结论速览（TL;DR）

0. **A0 探测已跑完（2026-11-09 真机，见附录 A）**，三条关键结论把方案的不确定性消掉了：
   - ✅ **R1 可用**：x.com 的 MSE + `blob:` 视频用 `MediaElementAudioSourceNode` 直采，峰值 **0.87**（非静音），采样率 16kHz。
   - ❌ **R2 不可靠**：`captureStream()` 能拿到音频轨，但 `MediaRecorder.start()` 直接报错 —— 不再作为主备选。
   - ✅ **R3 可行且不需要 MAIN world**：HLS 分片可 `fetch`（7 段 `.m4s`），且 `m3u8` 地址可从 `performance.getEntriesByType('resource')` 直接拿到（content script 同窗口可见）。
1. **真正的难点不是 Whisper，是"怎么把音频拿到手"**。扩展里没有 ffmpeg，也没有 Node，拿音频只有三条路（§3）。原版绕开这个问题的方式是把 URL 丢给服务器。
2. **推荐默认路线**：`MediaElementAudioSourceNode` 实时采集（R1）→ 16kHz 单声道 PCM → 30s 滚动窗口 → 本地 Whisper（`transformers.js` + ONNX Runtime Web）。
3. **本地模型不随包分发**，改为"用户点一下按需下载 + CacheStorage 持久化"，避免安装包 +40~250MB；离线环境支持"导入本地模型目录"。
4. **可配置化**落在三处：`asr.*` 配置树（defaults.ts）、provider 注册表（capabilities 驱动 UI）、消息协议（`asr:*`）。新增一个云端 ASR 只要写一个适配器 + 一条注册项，**不改 UI、不改调用方**。
5. **成本预期**（估；A2 已回填部分实测，见附录 E）：`whisper-base` q8 单线程在桌面 CPU 上约 **0.3–0.6× 实时**（1 分钟音频 100–200 秒）；`tiny` q8 更快但质量差。所以本地更适合"边看边识别"而非"秒出全片"；云 API 适合长视频/弱机型。**实测发现最大障碍不是速度，而是"模型从哪下"**（HuggingFace 权重 CDN 在部分网络不可达 → 用 ModelScope，见 §5.1 坑 3）。
6. **与原方案的关系**：ASR 只产出 `{start, end, text}` 的 cue 数组，**直接复用** x-com 方案 §5 的翻译管线与双语字幕层（`OverlayChannel`）。ASR 是"字幕来源"之一，不是新的渲染系统。

---

## 1. 目标、边界与约束

### 1.1 目标（可验收）

| # | 目标 | 验收口径 |
| --- | --- | --- |
| G1 | 无字幕轨的视频能出双语字幕 | 任选一条无 CC 的 x.com 视频，开启后 1 分钟内出现首条双语字幕 |
| G2 | 本地推理可离线 | 断网（除模型已下载）状态下仍能识别 |
| G3 | 云 API 可切换 | 设置页换 provider 后立刻生效，无需重启浏览器 |
| G4 | 可降级 | 本地不可用（wasm 不支持/内存不足）→ 自动提示并可切云；云失败 → 明确报错而非静默 |
| G5 | 可关闭 | 一键关闭后不加载模型、不申请音频、不产生任何网络请求 |

### 1.2 明确不做

- 说话人分离（diarization）、情感标注、字幕人工校对 UI（后续可选）。
- 视频重编码 / 字幕烧进画面（我们只叠加文字层）。
- DRM 视频（Widevine/PlayReady）——**音轨拿不到，直接拒绝并提示**。
- 云端"上传整个视频"：只上传抽取出的音频（隐私最小化）。

### 1.3 浏览器侧的硬约束

| # | 约束 | 影响 | 对策 |
| --- | --- | --- | --- |
| C1 | 扩展页 `crossOriginIsolated` 默认 false | ORT 多线程 wasm **可能**跑不起来（SAB 本身可构造，实测 true） | 默认 `numThreads:1`；A5 实测能否开多线程 |
| C2 | MV3 Service Worker 不能长期跑重计算/无 DOM | 推理必须放 offscreen | 复用现有 offscreen（已承载 tesseract OCR） |
| C3 | 跨域媒体 + 无 CORS 头 → WebAudio 输出静音（"tainted"） | 部分站点采集失败 | 用 `hasSignal`（RMS）判定，失败降 R3 |
| C4 | MSE（`blob:` src）不受媒体元素 CORS 污染 | x.com 这类站**可以直接采** | ✅ 已实测：峰值 0.87 |
| C5 | 模型文件体积大 | 商店审核/安装体验 | 按需下载 + 量化解码 + 可删除 |
| C6 | `storage.sync` 单键 8KB | 放不下模型元数据/长配置 | 配置切片；密钥与模型索引放 `storage.local` |

---

## 2. 现有基础与缺口（代码级，可复核）

### 2.1 已有可复用

| 能力 | 位置 | 复用方式 |
| --- | --- | --- |
| Offscreen 文档 + 消息入口 | `src/entrypoints/offscreen/main.ts`（39 行，OCR 用） | 直接扩展：加 `asr:*` 分支，重活都在这里 |
| 适配器模式 | `src/core/services/{types,registry}.ts` | ASR provider 用**同一套模式**，降低认知成本 |
| 消息协议类型 | `src/core/messaging/protocol.ts`（`RequestMap` / `EventMap`） | 增量加 `asr:*` 键 |
| 字幕翻译与渲染 | `src/engine/subtitle.ts` + （方案 §5 的通道） | ASR 产出 cue 后**走同一条翻译/渲染链** |
| 配置三层合并 | `src/core/config/{defaults,merge,storage,ConfigStore}.ts` | `asr` 作为新分区，`ConfigStore.patch` 直接可用 |
| 缓存 | `src/core/services/cache.ts` | 复用语义（键含 provider+lang+audioHash） |

### 2.2 缺口

| 缺口 | 说明 |
| --- | --- |
| 音频摄取 | 完全没有（`subtitle.ts` 只处理 `<track>`） |
| 轨道探测与"无轨"判定 | 没有：需要判断"这个 video 到底有没有轨、有没有 CC 入口" |
| ASR provider 抽象 | 没有 |
| 任务态（排队/进度/取消） | 没有：ASR 是长任务（分钟级），必须有进度与取消 |
| 模型管理与下载进度 | 没有 |
| 配置 UI | `Subtitle.vue` 目前写着"云端 ASR 已裁剪" |

---

## 3. 音频摄取：三条路线（**本方案的核心难点**）

> 先明确一件事：扩展里**没有** ffmpeg，也没有本地可执行的 demuxer。所以"拿到 16kHz 单声道 PCM"必须用浏览器 API 拼出来。

### 3.1 路线对比（含 A0 实测）

| 路线 | 原理 | 实时性 | 能否离线 | 关键技术风险 | 复杂度 | **A0 实测** |
| --- | --- | --- | --- | --- | --- | --- |
| **R1 WebAudio 直采** | `ctx.createMediaElementSource(video)` → `AudioWorklet` → PCM | 1×（可 `playbackRate=2` 提速） | ✅ | CORS taint → 静音 | 低 | ✅ **可用**：x.com MSE 视频峰值 0.87，`AudioContext({sampleRate:16000})` 生效 |
| **R2 captureStream 录制** | `video.captureStream()` → `MediaRecorder(opus)` → `decodeAudioData` | 1× | ✅ | 录制期间不能 seek；mime 支持不一 | 低 | ❌ **不可靠**：音频轨拿得到，但 `MediaRecorder.start()` 抛错 |
| **R3 网络取流解封装** | 从 `performance` 找 `.m3u8` → `fetch` 分片 → `mp4box.js` 解 fMP4 → `WebCodecs.AudioDecoder` 解 AAC → PCM | **可快于实时 / 可整片** | ✅ | 分片签名/防盗链；AAC 解码支持 | 高 | ✅ **可行**：7 段 `.m4s` 可取；`AudioDecoder` 支持 `mp4a.40.2` 与 `opus`；**不需要 MAIN world** |

### 3.2 决策（按实测修正）

```
默认：R1（实时、简单、x.com 实测可用）
  ├─ 探测失败（tainted / 全零样本）→ 降级 R3（取证：从 performance 抓 m3u8 → mp4box → WebCodecs）
  ├─ 用户开启「整片识别」或视频 > 15 分钟 → 用 R3（可快于实时，也便于给云 provider 传完整音频）
  └─ R2 仅作最后兜底（换 mimeType 重试），不列入默认路径
```

**为什么 R3 被提升为主备选**：A0 实测发现在 x.com 上

1. `performance.getEntriesByType('resource')` 能直接拿到 master/variant `.m3u8`（content script 与页面共享同一 `performance`）；
2. 分片 playlist 可 `fetch`（带 CORS 头），URL 形如 `/amplify_video/<id>/vid/avc1/0/3000/480x270/xxx.m4s`；
3. `AudioDecoder.isConfigSupported({codec:'mp4a.40.2'})` → `true`。

也就是说 R3 **既不需要 MAIN world、也不需要 hook fetch**，只要 `mp4box.js` + WebCodecs 就能离线整片解码。这让"整片识别"的成本从"高"降到"中"。

### 3.3 采集器设计（`AudioTap`）

```ts
export interface AudioTap {
  /** 采集并回调 16kHz 单声道 Float32 PCM（每帧 20–100ms） */
  start(video: HTMLVideoElement, onChunk: (pcm: Float32Array) => void): Promise<void>;
  stop(): void;
  /** 是否拿到有效信号（全零 = 被 taint 或静音） */
  readonly hasSignal: boolean;
}
```

要点：

1. **采样率转换**：`AudioContext({ sampleRate: 16000 })`，Chrome 支持在创建时指定采样率，省掉手动重采样；若被浏览器强制为 48k，则在 worklet 里做线性插值降采样。
2. **静音检测**：每 500ms 计算 RMS，连续 10 秒 RMS < 1e-4 → 判定"无信号"，触发降级（同时也避免把静音喂给 Whisper 造成幻觉输出）。
3. **时间戳对齐**：PCM 帧序号 × 采样点数 → 精确到毫秒的播放时间轴（**不要**用 `video.currentTime`，seek 会跳变）。seek/暂停时重置累加器。
4. **播放倍速**：`playbackRate` 可以提高采集速度（2–4×），但会影响音高——Whisper 对 2× 尚可，4× 明显掉准确率。默认 1×，允许配置 `asr.local.captureRate`（1/1.5/2）。
5. **多视频**：只采"当前活跃"的那个（判据同 x-com 方案 §5.2：`!muted && !paused` 或在弹层内）。

---

## 4. ASR Provider 抽象（可配置化的地基）

### 4.1 接口（与 `ServiceAdapter` 同构，降低学习成本）

```ts
// src/core/asr/types.ts
export type AsrProviderId =
  | 'local-whisper'        // 本地 transformers.js
  | 'openai-whisper'       // OpenAI /v1/audio/transcriptions
  | 'groq-whisper'         // Groq（OpenAI 兼容）
  | 'deepgram'             // Deepgram /v1/listen
  | 'whisper-cpp-server'   // 自建 whisper.cpp（/inference）
  | 'custom-openai-asr';   // 任意 OpenAI 兼容 ASR（末班车）

export interface AsrCue {
  start: number; // 秒
  end: number;
  text: string;
}

export interface AsrRequest {
  /** 16kHz mono 16bit PCM（云 provider 自行封 WAV/OGG） */
  audio: { pcm: Float32Array; sampleRate: number } | { url: string };
  language?: string;        // 'auto' | 'en' | 'zh' ...
  durationSec?: number;
  signal?: AbortSignal;
  onProgress?: (p: { stage: 'download' | 'decode' | 'infer'; ratio?: number; text?: string }) => void;
}

export interface AsrProvider {
  id: AsrProviderId;
  /** 能力描述：驱动 UI 自动渲染，不允许各页面硬编码 */
  capabilities: {
    kind: 'local' | 'cloud';
    needsKey: boolean;
    needsEndpoint: boolean;
    offline: boolean;
    supportsTimestamps: boolean;
    maxAudioSec: number;       // 单次上限
    models: string[];          // 可选模型列表
    langs: 'auto' | string[];  // 'auto' = 自带语言检测
    estSizeMB?: number[];      // 本地模型体积（对齐 models 索引）
    estSpeed?: number;         // 相对实时的倍数
  };
  transcribe(req: AsrRequest): Promise<AsrCue[]>;
  /** 本地 provider：预下载 / 删除 / 查询模型状态 */
  model?: {
    status(model: string): Promise<'absent' | 'downloading' | 'ready'>;
    download(model: string, onProgress: (r: number) => void): Promise<void>;
    remove(model: string): Promise<void>;
    sizeOnDiskMB(model: string): Promise<number>;
  };
}
```

### 4.2 注册表 + 选择策略

```ts
// src/core/asr/registry.ts
export function getAsrProvider(config: UserConfig): AsrProvider | null;
export function listAsrProviders(config: UserConfig): AsrProvider[];
```

选择逻辑（`asr.provider = 'auto'` 时）：

```
1. 本地模型已就绪 && 能力探测通过（wasm/SIMD/内存） → local-whisper
2. 配置了云 key/endpoint → 按 asr.cloudFallbackOrder 依次尝试
3. 都没有 → 返回 null，UI 提示"未配置 ASR"（不报错、不打扰）
```

### 4.3 能力矩阵（UI 直接照这个渲染，不写死）

| provider | kind | 需要 key | 需要 endpoint | 离线 | 时间戳 | 单次上限 | 体积 | 速度（估） |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `local-whisper` | local | ❌ | ❌ | ✅ | ✅ | 无（窗口切分） | 40/80/250MB | 0.15–0.6× 实时 |
| `openai-whisper` | cloud | ✅ | 可选（默认官方） | ❌ | ✅（`verbose_json`） | 25MB ≈ 10 分钟 | — | ≈ 实时~5× |
| `groq-whisper` | cloud | ✅ | 可选 | ❌ | ✅ | 同上 | — | 很快（专门加速硬件） |
| `deepgram` | cloud | ✅ | 可选 | ❌ | ✅ | 依套餐 | — | 快 |
| `whisper-cpp-server` | cloud(内网) | 可选 | ✅ | 局域网 | ✅ | 依实现 | — | 依机器 |
| `custom-openai-asr` | cloud | ✅ | ✅ | ❌ | 视实现 | 视实现 | — | 视实现 |

---

## 5. 本地 Whisper 方案（细节）

### 5.1 运行时选型

**`@huggingface/transformers` v4.3.2（transformers.js）+ ONNX Runtime Web（wasm 后端）**。

选它的理由（与参考实现对齐）：

- 参考产物里本来就有 `wasm/ort-wasm-simd-threaded.wasm`（11MB）与 `aifw/libner-*.js`（内含 `WhisperTokenizer` / `InferenceSession`），说明 ONNX 路线在原版里是"已经被验证可行"的（只是桌面版没用在字幕上）。
- 纯前端、无 Node 依赖，能跑在 offscreen 的 Worker/页面环境里。
- 自带模型下载 + CacheStorage 缓存 + 量化档选择。

**A2 落地时踩到的 4 个坑（都已在代码里解决，换环境/升级版本时重点复查）**：

| # | 现象 | 根因 | 解决 |
| --- | --- | --- | --- |
| 1 | `no available backend found ... Failed to fetch dynamically imported module: .../ort-wasm-simd-threaded.asyncify.mjs` | transformers.js 默认让 ORT 去 **jsDelivr** 拉与 dev 版本匹配的 `.mjs` 加载器，该 dev 版本在 CDN 上没有 | `scripts/copy-ort.mjs` 构建前把 `ort-wasm-simd-threaded.{mjs,wasm}` 拷进 `public/ort/`，`wasmPaths` 钉到 `chrome-extension://.../ort/`；`scripts/prune-ort.mjs` 构建后删掉 Vite 顺手打包的 25MB asyncify 变体 |
| 2 | `Compiling or instantiating WebAssembly module violates ... script-src 'self'` | **MV3 默认 CSP 不含 `'wasm-unsafe-eval'`** | `manifest.content_security_policy.extension_pages = "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'"` |
| 3 | 模型权重 `Failed to fetch`（`ERR_CONNECTION_CLOSED`） | HuggingFace 把大文件 302 到 `us.aws.cdn.hf.co`，该域名在部分网络不可达 | 支持 `asr.local.modelBaseUrl` + `modelRevision`：国内用 **ModelScope**（`https://www.modelscope.cn/models` + `master`）或 hf-mirror（+`main`） |
| 4 | `Failed to cache xxx.wasm: Request scheme 'chrome-extension' is unsupported` | CacheStorage 不接受 `chrome-extension://` 协议缓存 | 仅告警，可忽略（wasm 本来就在扩展包内） |

替代方案与取舍：

| 方案 | 优点 | 缺点 | 结论 |
| --- | --- | --- | --- |
| transformers.js（ONNX） | 生态成熟、模型全、API 简单 | 首次下载、单线程慢 | ✅ 采用 |
| whisper.cpp → wasm 自编译 | 速度更快、内存更省 | 需自己维护 wasm 构建与线程化 | 备选（A5 评估） |
| 原生（Node/Electron） | 最快 | 扩展里跑不了 | ❌ |

### 5.2 模型档位（按需下载）

| 模型（ONNX 社区版） | 量化 | 磁盘 | 中文可用性 | 建议场景 |
| --- | --- | --- | --- | --- |
| `onnx-community/whisper-tiny` | q8 | ≈ 40MB | 差（能听懂但错字多） | 快速预览 / 弱机 |
| `onnx-community/whisper-base` | q8 | ≈ 80MB | 一般 | **默认** |
| `onnx-community/whisper-small` | q8 | ≈ 250MB | 较好 | 认真看长视频 |
| `whisper-large-v3-turbo` | q4/q8 | ≥ 800MB | 好 | 不推荐在扩展里跑（体积/内存） |

> 体积为社区常见量化档的**估算值**，实现时以 `model.sizeOnDiskMB()` 实测为准，并写进 UI 提示。

### 5.3 存放与下载

- **模型权重**：transformers.js 自带 `CacheStorage` 缓存（`env.useBrowserCache = true`）。Key 由 HF URL 决定。
- **下载触发**：只在用户"开启无字幕识别"并首次使用时下载；UI 显示进度条 + 可中断。
- **离线/内网部署**：支持 `asr.local.modelBaseUrl` 指向自建静态目录（把 ONNX 文件放到公司内网/本地 HTTP），或"导入本地文件夹"（`File System Access API`，把文件读进 CacheStorage）。
- **权限**：需要 `unlimitedStorage`（CacheStorage 在扩展里默认也有配额，显式声明更稳），以及 `host_permissions` 追加 `https://huggingface.co/*`、`https://cdn-lfs.huggingface.co/*`。

### 5.4 推理参数

```ts
const pipe = await pipeline('automatic-speech-recognition', modelId, {
  dtype: 'q8',
  device: 'wasm',
  numThreads: 1,            // C1：扩展页无 SharedArrayBuffer
});
const out = await pipe(pcmFloat32, {
  language: 'auto',          // 或 'en' | 'zh'
  task: 'transcribe',
  return_timestamps: true,   // chunk 级时间戳
  chunk_length_s: 30,
  stride_length_s: 5,
  // 关键：短音频不要开 chunk，否则时间戳会漂
});
```

产出 → cue：

```ts
type WhisperChunk = { timestamp: [number, number | null]; text: string };
function toCues(chunks: WhisperChunk[], offsetSec: number): AsrCue[] {
  return chunks
    .filter((c) => c.text.trim())
    .map((c, i, arr) => ({
      start: offsetSec + (c.timestamp[0] ?? 0),
      end: offsetSec + (c.timestamp[1] ?? arr[i + 1]?.timestamp?.[0] ?? c.timestamp[0] + 3),
      text: c.text.trim(),
    }));
}
```

### 5.5 性能与体验策略

| 策略 | 说明 |
| --- | --- |
| 滚动窗口 | 每 30s 音频（含 5s 重叠）跑一次，边看边出字幕；首条字幕延迟 ≈ 30s × 实时率 + 解码 |
| 先 tiny 后 base | 首条字幕用 tiny 快速出，后台用 base 重算并静默替换（配置项 `asr.local.progressive`） |
| 限制并发 | 同时只跑 1 个推理任务（单线程 wasm 抢不到多核，跑两个反而都慢） |
| 取消 | `AbortSignal` + `worker.terminate()`；切视频/关页面必须停 |
| 电量/发热 | 连续推理 5 分钟后提示"已暂停，点此继续"（避免笔记本风扇起飞） |

---

## 6. 云 API 方案（细节）

### 6.1 统一请求形态

所有云 provider 都从 **background** 发请求（扩展有 `host_permissions`，不受 CORS 限制），音频由 offscreen 编码成 16kHz mono WAV（或按需 OGG/Opus），不超过 provider 的单次上限（默认 10 分钟/25MB），超长自动切片并**按偏移合并 cue**。

### 6.2 四个内置实现

| provider | 端点 | 关键参数 | 时间戳来源 |
| --- | --- | --- | --- |
| `openai-whisper` | `POST {endpoint}/v1/audio/transcriptions` | `model=whisper-1`、`response_format=verbose_json`、`language?` | `segments[].start/end/text` |
| `groq-whisper` | `POST https://api.groq.com/openai/v1/audio/transcriptions` | `model=whisper-large-v3-turbo`、`response_format=verbose_json` | 同上（OpenAI 兼容） |
| `deepgram` | `POST https://api.deepgram.com/v1/listen?model=nova-2&smart_format=true&utterances=true` | `Authorization: Token <key>`、body 为原始音频 | `results.channels[0].alternatives[0].words[]` 聚合 |
| `whisper-cpp-server` | `POST {endpoint}/inference` | `response_format=verbose_json`（whisper.cpp server 支持） | `segments[]` |

### 6.3 错误与降级

```
401/403 → 明确提示"密钥无效"，停止重试（不要反复刷）
429     → 按 Retry-After 退避，最多 3 次
5xx     → 退避重试 2 次 → 切下一个 provider（asr.cloudFallbackOrder）
超长    → 自动切片（不改用户配置）
无时间戳 → 退化为"整段一块"（仍能翻译，但字幕不分句）→ 在 UI 标注
```

### 6.4 隐私

- 只上传**抽取出的音频**，不上传视频、不上传页面 URL（可在请求里去掉 metadata）。
- 首次使用云 provider 弹一次确认："音频将上传至 {provider}"，可就地切本地。

---

## 7. 配置模型（可配置化的落点）

### 7.1 `defaults.ts` 增量

```ts
export interface AsrConfig {
  /** 总开关：无字幕视频是否允许 ASR */
  enabled: boolean;
  /** 'auto' = 能用本地就用本地，否则按 cloudFallbackOrder；'off' = 完全不启用 */
  provider: 'auto' | 'off' | AsrProviderId;
  /** 自动触发策略 */
  auto: {
    whenNoTrack: boolean;      // 探测到无字幕轨时提示（默认 true，**只提示不自动跑**）
    minWatchSeconds: number;   // 播放超过 N 秒才提示（默认 10，避免划走就弹）
    maxDurationMin: number;    // 超过则提示"建议用云"（默认 15）
  };
  local: {
    model: 'whisper-tiny' | 'whisper-base' | 'whisper-small';
    dtype: 'q8' | 'fp16' | 'fp32';
    numThreads: number;        // 默认 1（扩展页无 SAB）
    progressive: boolean;      // tiny 先行、base 替换（A3）
    modelBaseUrl: string;      // 空 = HuggingFace；或 ModelScope / hf-mirror / 内网
    modelRevision: string;     // HuggingFace=main，ModelScope=master
  };
  /** 音频采集窗口（与 provider 无关，本地/云端都按这个切） */
  capture: {
    windowSec: number;         // 默认 30
    strideSec: number;         // 默认 5
    captureRate: 1 | 1.5 | 2;  // 播放倍速采集（默认 1）
    silenceRms: number;        // 静音门限（默认 0.004）：低于此值窗口直接丢弃，防幻觉
  };
  cloud: {
    provider: AsrProviderId;
    endpoint: string;          // 空 = provider 默认
    apiKey: string;            // 存 storage.local，不进 sync
    model: string;
    language: 'auto' | string;
    chunkMinutes: number;      // 默认 10
    timeoutMs: number;         // 默认 120000
    fallbackOrder: AsrProviderId[];
  };
  /** 产出字幕之后的处理（复用现有字幕配置） */
  pipeline: {
    translate: boolean;              // 产出后是否自动翻译（默认 true）
    service: string;                 // 'inherit' | 具体服务 id
    displayMode: 'dual' | 'only';    // 复用 subtitle.displayMode 亦可
  };
  cache: { enabled: boolean; ttlDays: number };
}
```

> 兼容性说明：`asr.pipeline.*` 与现有 `subtitle.*` 有意重叠但**不合并**——字幕翻译是"有轨"和"无轨"两条来源，允许分别设置服务与显示模式；UI 上用"跟随字幕设置"（默认）来避免用户困惑。

### 7.2 密钥与体积的分层存储

| 数据 | 存储位置 | 原因 |
| --- | --- | --- |
| `asr.cloud.apiKey` | `storage.local` | sync 单键 8KB 且会跨设备同步（密钥不宜） |
| 模型状态索引 | `storage.local` | 只是元数据，体积小 |
| 模型权重 | CacheStorage | 大文件，浏览器管理配额与淘汰 |
| 其余 `asr.*` 配置 | `storage.sync`（沿用现有 userConfig） | 需要跨设备一致 |

### 7.3 设置页（`#subtitle` 新增分区）

```
视频字幕
  …现有项…
  ── 无字幕视频（ASR） ──────────────────────────
  [开关] 为没有字幕的视频生成字幕
        说明：本机识别（Whisper）或云端识别，二者都只处理音频。
  [下拉] 识别方式      （本地 Whisper / OpenAI / Groq / Deepgram / 自建 / 自定义）  ← 由 capabilities 渲染
  ── 本地模型 ──        （provider 选本地时显示）
      模型：[tiny 40MB] [base 80MB] [small 250MB]
      状态：[未下载] → [下载中 62%] → [已就绪 · 80MB · 删除]
      线程：[1]（扩展环境不支持多线程 wasm，已锁）
      语言：跟随视频 / 指定
      [开关] 先用小模型出字幕，再用大模型替换
  ── 云端识别 ──        （provider 选云时显示）
      端点：[默认 / 自定义]
      密钥：[••••••] [测试连接]
      模型：[whisper-1]
      单次切片：[10] 分钟
      失败后依次尝试：[本地 → Groq → OpenAI]（可拖排序）
  ── 触发与产出 ──
      [开关] 检测到无字幕时提示（不自动运行）
      [开关] 识别后自动翻译   [服务：跟随字幕设置]
      [按钮] 清除已缓存的识别结果
```

> 这套 UI 由 `capabilities` 驱动：新增 provider 只需在注册表里声明，**页面无需改代码**（这是"可配置化"的关键验收点，见 §11 V4）。

### 7.4 缓存

```
key   = asr:<providerId>:<model>:<lang>:<audioFingerprint>
value = { cues: AsrCue[]; createdAt: number; durationSec: number }
audioFingerprint = 视频 URL 的 pathname 哈希（不含查询参数，避免签名变化）+ 时长
```
同一视频重复观看：**零推理、零请求**（命中即用）。

---

## 8. 消息协议与代码落点

### 8.1 `protocol.ts` 增量

```ts
// 请求-响应
'asr:probe':      { req: { videoUrl: string }; res: { hasTrack: boolean; hasCCButton: boolean; durationSec: number; canCapture: boolean } };
'asr:transcribe': { req: { videoUrl: string; durationSec: number; lang?: string }; res: { cues: AsrCue[]; provider: AsrProviderId; cached: boolean } };
'asr:model':      { req: { action: 'status' | 'download' | 'remove'; model: string }; res: { status: string; sizeMB?: number } };
// 事件（background → content / UI）
'asr:progress':   { stage: 'download' | 'decode' | 'infer'; ratio?: number; text?: string };
'asr:error':      { code: 'tainted' | 'no-provider' | 'auth' | 'quota' | 'timeout'; message: string };
```

### 8.2 数据流

```
content（页面）
  ├─ 轨道探测：video.textTracks / CC 按钮 / duration
  ├─ AudioTap 采集 PCM（R1，失败降级 R2）
  ├─ 30s 窗口 → sendMessage('asr:transcribe', { pcm?… })
  ↓
background（调度）
  ├─ 查缓存 asr:* → 命中直接返回
  ├─ provider = local → 转发 offscreen
  ├─ provider = cloud → 编码 WAV → fetch 上传 → 解析 segments
  └─ 失败按 fallbackOrder 降级
  ↓
offscreen（重计算）
  ├─ transformers.js pipeline（wasm 单线程）
  └─ 进度回调 → asr:progress
  ↓
content ← cues → 复用字幕翻译管线 → OverlayChannel 渲染双语
```

### 8.3 文件清单

| 文件 | 动作 | 职责 |
| --- | --- | --- |
| `src/core/asr/types.ts` | 新增 | Provider 接口 / AsrCue / 能力描述 |
| `src/core/asr/registry.ts` | 新增 | 注册表 + `getAsrProvider` + 选择与降级 |
| `src/core/asr/providers/local-whisper.ts` | 新增 | 跑在 offscreen；模型管理与推理 |
| `src/core/asr/providers/openai-whisper.ts` | 新增 | OpenAI/Groq 共用一个实现（同协议，不同默认端点/模型） |
| `src/core/asr/providers/deepgram.ts` | 新增 | Deepgram 适配 |
| `src/core/asr/providers/whisper-cpp.ts` | 新增 | 自建 whisper.cpp server |
| `src/core/asr/cache.ts` | 新增 | `asr:*` 缓存读写 |
| `src/core/asr/audio/{tap.ts,resample.ts,wav.ts}` | 新增 | R1/R2 采集、重采样、WAV 编码 |
| `src/engine/subtitle/watchdog.ts` | 新增 | 无轨探测 + 提示 + 触发 ASR |
| `src/entrypoints/offscreen/main.ts` | 改造 | 加 `asr:*` 分支与 Worker 承载 |
| `src/entrypoints/background.ts` | 改造 | `asr:*` 调度、缓存、云请求、降级 |
| `src/entrypoints/content.ts` | 改造 | 采集与字幕源接线 |
| `src/core/config/defaults.ts` | 改造 | `asr` 分区 |
| `src/entrypoints/options/pages/Subtitle.vue` | 改造 | ASR 分区 UI（capabilities 驱动） |
| `wxt.config.ts` | 改造 | `unlimitedStorage` + HF host_permissions |

---

## 9. 分阶段实施计划

| 阶段 | 内容 | 验收 | 估时 |
| --- | --- | --- | --- |
| **A0 实测** ✅**已完成** | 附录 A 三个探测：x.com 视频 R1 采集 / WebCodecs AAC / 扩展页 SAB；结果见 §0 与附录 A | 主路线确定为 R1，备选 R3 | 0.5 天 |
| **A1 骨架 + 云 API** | `asr` 配置树、provider 注册表、`asr:*` 协议、offscreen 路由、OpenAI/Groq 两个云 provider、WAV 编码、缓存 | 任意带音频的网页视频 → 云端识别 → 双语字幕（不依赖本地模型） | 1.5 天 |
| **A2 本地 Whisper MVP** | transformers.js + tiny/base、模型下载/删除/进度、单线程推理、滚动窗口 | 断网可识别；1 分钟音频 ≤ 3 分钟出字幕 | 2 天 |
| **A3 体验打磨** | 无轨提示、进度 UI、取消、tiny→base 渐进、缓存命中、设置页完整 UI | §11 验收清单 A/C 组全绿 | 1 天 |
| **A4 降级与稳健（含 R3）** | tainted 判定、**R3 整片取流（performance + m3u8 + mp4box + WebCodecs）**、DRM 拒绝、长视频切片、fallbackOrder、隐私确认 | §11 B 组全绿；长视频可整片识别 | 2 天 |
| **A5（可选）性能对比** | whisper.cpp-wasm 与 transformers.js 的速度/内存对比；必要时 COOP/COEP 线程化 spike | 产出选型结论 | 1.5 天 |

合计：**A0–A4 ≈ 7 天**（A0 已完成，剩 6.5 天；AI 协作下有效工时），A5 另计。

---

## 10. 风险与对策

| # | 风险 | 概率 | 影响 | 对策 |
| --- | --- | --- | --- | --- |
| R1 | `MediaElementAudioSourceNode` 拿到静音（CORS taint） | **低**（x.com 已实测可用，0.87 峰值） | 主路线失效 | 保留 `hasSignal` 判定；某些直连跨域 mp4 的站点改用 R3 |
| R2 | 扩展页 `crossOriginIsolated=false` → ORT 多线程受限 | 中（SAB 可构造，但 COI=false） | 推理慢 2–4× | 默认 `numThreads:1`；A5 实测多线程是否可用，再决定是否 COOP/COEP |
| R3 | `MediaRecorder` 路线不可用（A0 实测 start 抛错） | **已发生** | R2 不能作降级 | 主降级改为 R3（取流解封装），而非录制 |
| R4 | 模型下载 40–250MB 用户不愿等 | 高 | 转化率低 | 首次仅 tiny（40MB）；提供"内网/本地模型目录"；云端 provider 作为免下载选项 |
| R5 | Whisper 对音乐/嘈杂现场幻觉输出（编造句子） | 高 | 字幕乱码 | `condition_on_previous_text=false`、`no_speech_threshold` 调高、RMS 静音丢帧、`focusDialogue` 过滤 |
| R6 | 长视频内存爆（PCM 96KB/s，1 小时 ≈ 345MB） | 中 | 崩溃 | 只保留滚动窗口（30s×2）+ 已产出的 cue；禁止整片缓存 PCM |
| R7 | 云 API 费用/限流 | 中 | 成本 | 默认禁用云端；显示预估费用；缓存命中；`chunkMinutes` 可调 |
| R8 | 密钥泄露（明文存储） | 中 | 安全 | 存 `storage.local`；UI 掩码显示；导出配置**剔除**密钥 |
| R9 | DRM 视频（Netflix 等） | 中 | 无法处理 | 探测 `video.mediaKeys` 存在即拒绝并提示"受保护内容"（x.com 实测 `mediaKeys=null`，不受影响） |
| R10 | 与站点自带 CC 冲突（重复字幕） | 中 | 体验 | 有轨优先用轨；ASR 只在"无轨"或用户显式要求时启用 |

---

## 11. 验收清单

**A 组（功能）**
- [ ] 无 CC 的 x.com 视频：点开提示 → 开启 → 30–90s 内出现首条双语字幕
- [ ] 有 CC 的视频：仍走轨道翻译，不触发 ASR（不浪费算力）
- [ ] 关闭 ASR 后：不下载模型、不建 AudioContext、无网络请求（DevTools 验证）
- [ ] 切到另一条视频：旧任务被取消，新任务正常
- [ ] 重复观看同一视频：命中缓存，0 推理 0 请求
- [ ] 云 provider：填入错误 key → 明确报"密钥无效"，不无限重试
**B 组（健壮性）**
- [ ] 静音/无音轨视频 → 提示而不是产出空字幕
- [ ] 跨域直连 mp4（tainted）→ 自动降级 R2 或明确报错
- [ ] DRM 视频 → 明确拒绝
- [ ] 推理中关闭标签页 → offscreen 任务终止，不留僵尸 Worker
**C 组（可配置化）**
- [ ] V1 切换 provider 立即生效（无需重启浏览器）
- [ ] V2 本地/云各自参数齐全（模型/端点/密钥/切片/超时）
- [ ] V3 降级顺序可配置并生效
- [ ] **V4 新增一个 provider 只需要"一个适配器文件 + 一条注册项"，UI 自动出现且可配置**（关键验收）

---

## 12. 附录

### A. A0 探测（**已执行**，2026-11-09，Chrome 157 / 24 核 / 16GB）

**A4 实测结果**

| 项 | 结果 | 结论 |
| --- | --- | --- |
| 扩展页 `crossOriginIsolated` | `false` | ORT 多线程不确定 |
| 扩展页 `new SharedArrayBuffer(16)` | ✅ 可构造 | 与 COI=false 并存，需 A5 实测多线程 |
| wasm SIMD | ✅ | 走 SIMD 版 wasm |
| `AudioDecoder`（`mp4a.40.2` / `opus`） | ✅ / ✅ | R3 的 AAC 解码可行 |
| 硬件并发 / 内存 | 24 核 / 16GB | 测试基线 |
| x.com 视频 `currentSrc` | `blob:`（MSE） | 典型场景 |
| `video.crossOrigin` / `mediaKeys` | `null` / `null` | 无 CORS 属性、非 DRM |
| **R1 采集峰值** | **0.87** | ✅ **拿到真实音频，未 taint** |
| `AudioContext({sampleRate:16000})` | 生效 | 不需要手动重采样 |
| `captureStream()` 音频轨 | 能拿到 | — |
| `MediaRecorder.start()` | ❌ 抛错 | R2 不作默认 |
| HLS 分片可 `fetch` | ✅ 7 段 `.m4s` | R3 可行 |
| `m3u8` 地址来源 | `performance.getEntriesByType('resource')` | 不需要 MAIN world |

**A1. x.com 视频 WebAudio 采集脚本**（已跑，留作回归）

```js
(async () => {
  const v = document.querySelector('video');
  console.log('src:', v?.currentSrc?.slice(0, 80), 'crossOrigin:', v?.crossOrigin, 'mediaKeys:', v?.mediaKeys);
  const ctx = new AudioContext({ sampleRate: 16000 });
  const src = ctx.createMediaElementSource(v);
  const an = ctx.createAnalyser();
  src.connect(an);
  an.connect(ctx.destination);          // 保住原声（否则视频会静音）
  await ctx.resume();
  const buf = new Float32Array(an.fftSize);
  let peak = 0;
  for (let i = 0; i < 25; i++) {
    await new Promise(r => setTimeout(r, 120));
    an.getFloatTimeDomainData(buf);
    for (const s of buf) peak = Math.max(peak, Math.abs(s));
  }
  console.log('peak(0 = 被污染/静音):', peak.toFixed(4));
  ctx.close();
})();
```

**A2. WebCodecs / 隔离状态**

```js
const aac = await AudioDecoder.isConfigSupported({ codec: 'mp4a.40.2', sampleRate: 44100, numberOfChannels: 2 });
let sab = false; try { new SharedArrayBuffer(16); sab = true; } catch {}
console.log({ aac: aac.supported, crossOriginIsolated: self.crossOriginIsolated, sab, cores: navigator.hardwareConcurrency });
```

**A3. HLS 分片可自取性**

```js
const urls = performance.getEntriesByType('resource').map(e => e.name).filter(u => /\.m3u8/.test(u));
const t = await fetch(urls[1]).then(r => r.text());   // variant playlist
console.log({ segments: (t.match(/#EXTINF/g) || []).length, sample: t.split('\n').find(l => l && !l.startsWith('#')) });
```

### B. 本地推理关键骨架

```ts
// src/core/asr/providers/local-whisper.ts（跑在 offscreen）
import { pipeline, env } from '@huggingface/transformers';

env.allowLocalModels = false;
env.useBrowserCache = true;

let pipe: any = null;
let currentModel = '';

async function getPipe(model: string, dtype: string, onProgress?: (r: number) => void) {
  if (pipe && currentModel === model) return pipe;
  currentModel = model;
  pipe = await pipeline('automatic-speech-recognition', `onnx-community/${model}`, {
    dtype,
    device: 'wasm',
    numThreads: 1,
    progress_callback: (p: { status: string; loaded?: number; total?: number }) => {
      if (p.status === 'progress' && p.total) onProgress?.(p.loaded! / p.total);
    },
  });
  return pipe;
}

export async function transcribeLocal(req: AsrRequest, cfg: AsrConfig) {
  const p = await getPipe(cfg.local.model, cfg.local.dtype, (r) => req.onProgress?.({ stage: 'download', ratio: r }));
  const out = await p(req.audio.pcm, {
    language: req.language && req.language !== 'auto' ? req.language : undefined,
    task: 'transcribe',
    return_timestamps: true,
    chunk_length_s: cfg.local.windowSec,
    stride_length_s: cfg.local.strideSec,
  });
  return toCues(out.chunks ?? [{ timestamp: [0, null], text: out.text }], 0);
}
```

### C. 云 API 请求样例

```ts
// OpenAI / Groq（同一实现，不同默认值）
const fd = new FormData();
fd.append('file', new Blob([wavBuffer], { type: 'audio/wav' }), 'audio.wav');
fd.append('model', cfg.cloud.model);           // whisper-1 / whisper-large-v3-turbo
fd.append('response_format', 'verbose_json');
if (lang !== 'auto') fd.append('language', lang);
const res = await fetch(`${endpoint}/v1/audio/transcriptions`, {
  method: 'POST',
  headers: { authorization: `Bearer ${cfg.cloud.apiKey}` },
  body: fd,
  signal: withTimeout(undefined, cfg.cloud.timeoutMs),
});
const json = await res.json();
const cues = json.segments.map((s: any) => ({ start: s.start, end: s.end, text: s.text.trim() }));
```

### D. 两套配置示例

**D1. 纯本地（默认推荐，隐私最好）**

```json
{
  "asr": {
    "enabled": true,
    "provider": "auto",
    "auto": { "whenNoTrack": true, "minWatchSeconds": 10, "maxDurationMin": 15 },
    "local": { "model": "whisper-base", "dtype": "q8", "numThreads": 1,
               "windowSec": 30, "strideSec": 5, "captureRate": 1,
               "progressive": true, "modelBaseUrl": "" },
    "pipeline": { "translate": true, "service": "inherit", "displayMode": "dual" },
    "cache": { "enabled": true, "ttlDays": 30 }
  }
}
```

**D2. 云优先（弱机型 / 长视频）**

```json
{
  "asr": {
    "enabled": true,
    "provider": "groq-whisper",
    "local": { "model": "whisper-tiny", "dtype": "q8", "numThreads": 1,
               "windowSec": 30, "strideSec": 5, "captureRate": 1,
               "progressive": false, "modelBaseUrl": "" },
    "cloud": {
      "provider": "groq-whisper",
      "endpoint": "https://api.groq.com/openai",
      "apiKey": "<存 storage.local，此处仅为示意>",
      "model": "whisper-large-v3-turbo",
      "language": "auto",
      "chunkMinutes": 10,
      "timeoutMs": 120000,
      "fallbackOrder": ["local-whisper", "openai-whisper"]
    },
    "pipeline": { "translate": true, "service": "inherit", "displayMode": "dual" }
  }
}
```

### E. 实测基线（A2 首次回填，2026-11-09）

环境：Chrome 157 / 24 核 / 16GB / 单线程 wasm（`crossOriginIsolated=false`）/ 模型源 ModelScope。

| 指标 | whisper-tiny q8 | base q8 | small q8 | 说明 |
| --- | --- | --- | --- | --- |
| 模型体积 | ≈40MB（encoder+decoder+tokenizer） | 待测 | 待测 | 首次从 ModelScope 下载，之后走 CacheStorage |
| 首次下载耗时 | ≈1–2 分钟（视网络） | 待测 | 待测 | 实测缓存命中后启动 <1s |
| ORT 初始化 | ≈1–3s（首次编译 wasm） | 同 | 同 | 之后复用 pipeline 实例 |
| 识别延迟 | 8s 窗口 → 秒级出结果 | 待测 | 待测 | 未做严格基准，A5 补 |
| 中文质量 | 差（本次英文采访可用） | 待测 | 待测 | tiny 建议只做"快速预览" |
| 幻觉抑制 | ✅ silenceRms 门限 + 复读压缩 + `no_speech_threshold` | 同 | 同 | 未加前会出现 "who are in the world…" 刷屏 |
| 扩展产物体积 | 21.8MB（含 ORT wasm 13.6MB + tesseract 6.6MB） | — | — | asyncify/jsep/jspi 变体已在 postbuild 删除 |

---

## 13. 配置指南（照做即可用）

> 本节是"给其他人看"的操作手册：从构建装载到逐个服务配置，再到排错与验收。
> **当前实现状态见 §14**：云 API 与本地 Whisper（A2）均已可用。

### 13.1 第 0 步：构建并装载扩展

```powershell
# 1) 构建
pnpm build                       # 产物在 .output/chrome-mv3

# 2) 装载（Chrome 137+ 已忽略 --load-extension，只能手动或写 profile）
#    手动：chrome://extensions → 打开右上「开发者模式」→「加载已解压」→ 选 .output\chrome-mv3
```

> ⚠️ **重建后必须让它重新读代码**，否则你改的/新加的功能不会生效：
> - 手动装载：在 `chrome://extensions` 点该扩展卡片上的「重新加载」；
> - 用 profile 注册（自动化场景）：先退出 Chrome，**只删脚本缓存**
>   `<profile>\Default\Service Worker\ScriptCache`（与 `Default\Code Cache`），再启动。
>   **不要把整个 `Service Worker` 目录删掉**——本地 Whisper 的模型权重就缓存在同目录的
>   `CacheStorage` 里，删了要重下 40–250MB（本项目实测踩过）。
> - **否则 Service Worker 会命中旧脚本缓存**（实测：源码已 34988 字节，SW 仍跑 25354 字节的旧版，导致新消息类型全部返回 `undefined`）。
> - 内容脚本会随页面刷新更新，但**已打开的标签页需要刷新**才生效。

### 13.2 第 1 步：打开总开关

`设置页（options）→ 视频字幕 → 无字幕视频（语音识别）`

| 配置项 | 键 | 默认 | 说明 |
| --- | --- | --- | --- |
| 为没有字幕的视频生成字幕 | `asr.enabled` | `false` | **总闸**。关闭后不采集音频、不建 AudioContext、不发任何 ASR 请求 |
| 识别方式 | `asr.cloud.provider` | `openai-whisper` | 下拉项由 provider 能力表生成；`local-whisper` 在 A2 前显示为不可选 |
| 检测到无字幕时自动识别 | `asr.auto.whenNoTrack` | `true` | 关闭后只处理有字幕轨的视频（手动按钮在 A3） |
| 播放多久后开始识别 | `asr.auto.minWatchSeconds` | `10` | 秒。避免划走就起任务 |
| 识别后自动翻译 | `asr.pipeline.translate` | `true` | 关掉只显示识别原文 |
| 识别结果缓存 | `asr.cache.enabled` | `true` | 同一段音频复用结果，省钱省电 |

### 13.3 第 2 步：按服务填写参数

#### A) OpenAI Whisper

| 字段 | 值 |
| --- | --- |
| 接口端点 | 留空（默认 `https://api.openai.com`） |
| API Key | `sk-...`（[platform.openai.com](https://platform.openai.com/api-keys) 创建） |
| 模型 | `whisper-1`（或 `gpt-4o-transcribe`） |
| 识别语言 | `auto` 或 `en`/`zh`…（指定可减少误判） |
| 单次切片 | 10 分钟（官方 25MB 上限，10 分钟 16k/16bit 约 19MB） |

实际请求：`POST https://api.openai.com/v1/audio/transcriptions`，`multipart/form-data`，`response_format=verbose_json`，时间戳取 `segments[]`。

#### B) Groq Whisper（最快、最便宜）

| 字段 | 值 |
| --- | --- |
| 接口端点 | 留空（默认 `https://api.groq.com/openai`） |
| API Key | [console.groq.com/keys](https://console.groq.com/keys) |
| 模型 | `whisper-large-v3-turbo`（或 `whisper-large-v3`） |

与 OpenAI 完全同协议，只是端点/模型不同 —— 这也是"一个适配器覆盖多个服务"的例子。

#### C) Deepgram Nova

| 字段 | 值 |
| --- | --- |
| 接口端点 | 留空（默认 `https://api.deepgram.com`） |
| API Key | [console.deepgram.com](https://console.deepgram.com) 的 API Keys |
| 模型 | `nova-2`（或 `nova-3`） |

实现细节与其他三家不同：用 `Authorization: Token <key>`（不是 Bearer），body 传**原始音频二进制**（不是 multipart），时间戳从 `results.channels[0].alternatives[0].words[]` 按标点/停顿聚合成句。

#### D) 自建 whisper.cpp server（局域网、无 Key、可离线）

```bash
# 起服务（官方镜像；模型按需换）
docker run -d --name whisper-server -p 8080:8080 \
  -v ~/whisper-models:/models \
  ghcr.io/ggerganov/whisper.cpp:main \
  --model /models/ggml-base.bin --host 0.0.0.0 --port 8080 --inference-path /inference
```

| 字段 | 值 |
| --- | --- |
| 接口端点 | `http://127.0.0.1:8080`（或内网 IP） |
| API Key | 不需要（若反代加了鉴权，填对应 token） |
| 模型 | 随便填（服务端固定模型，字段仅透传） |

实现走 `/inference` 而非 `/v1/audio/transcriptions`（whisper.cpp server 的路由约定）。

#### E) 任意自定义 OpenAI 兼容 ASR

只要对方接受 `multipart/form-data` + `response_format=verbose_json`，就能接：

| 字段 | 值 |
| --- | --- |
| 接口端点 | `http://内网地址:端口`（**必须填**） |
| API Key | 视服务而定 |
| 模型 | 视服务而定 |

#### F) 本地 Whisper（隐私最好、可离线；A2 已接入）

| 字段 | 说明 |
| --- | --- |
| 识别方式 | 选「本地 Whisper」（或「自动（本机优先）」） |
| 本地模型 | `whisper-tiny`(≈40MB) / `whisper-base`(≈80MB) / `whisper-small`(≈250MB)；中文建议 base 起步 |
| 量化 | `q8` 默认（体积小、速度最快）；fp16/fp32 精度更高但更慢更大 |
| 模型状态 | 点「下载模型」→ 进度条 → 「已就绪（离线可用）」；可「删除模型」回收空间 |
| 模型来源 | 见下表；三选一预设，也可手填任意静态目录 |
| 版本(revision) | HuggingFace 用 `main`；**ModelScope 必须用 `master`** |

**模型来源预设（实测可用性）**：

| 预设 | `modelBaseUrl` | `revision` | 实测 |
| --- | --- | --- | --- |
| HuggingFace 官方 | 留空 | `main` | ⚠️ 权重会 302 到 `us.aws.cdn.hf.co`，部分网络连不上（本项目实测 `ERR_CONNECTION_CLOSED`） |
| **ModelScope（国内推荐）** | `https://www.modelscope.cn/models` | `master` | ✅ 实测可下（有 `onnx/` 目录，支持 Range 断点） |
| hf-mirror | `https://hf-mirror.com` | `main` | ⚠️ 可用但会限流（HEAD/高频请求 429） |
| 自建静态目录 | `https://your.cdn/whisper` | 自定义 | 目录需按 `{model}/resolve/{revision}/…` 摆放 |

下载完成后：完全离线可用（权重在 CacheStorage，wasm 在扩展包内）。首次识别会初始化 ORT（约 1–3s），之后按窗口持续出字幕。

### 13.4 第 3 步：验证（三层）

1. **端点连通性**：设置页点「测试」→ 用 0.3 秒静音打一次真实请求，返回 `连接成功：<provider>（<ms>ms）` 即可。
   失败会直接显示原因（`未配置 API Key` / `ASR 鉴权失败（HTTP 401）` / `ASR 请求超时` …）。
2. **链路自检**：随便打开一条**无字幕**的视频并播放 → 视频下方出现「正在识别音频…」→ 一个采集窗口（默认 30s）后出现原文，随后出现译文。
3. **缓存自检**：再播一遍同一段 → 秒出（后台命中 `asr:*` 缓存，无网络请求）。

### 13.5 用本地假端点联调（**不需要任何 Key**）

适合开发/CI：起一个只会返回固定字幕的 OpenAI 兼容端点，验证"采集→编码→上传→解析→翻译→浮层"整条链路。

```js
// tools/fake-asr.mjs（Node 20+）
import http from 'node:http';
http.createServer(async (req, res) => {
  const chunks = []; for await (const c of req) chunks.push(c);
  const buf = Buffer.concat(chunks);
  const i = buf.indexOf(Buffer.from('RIFF'));
  const wav = i >= 0 ? buf.subarray(i) : Buffer.alloc(0);
  const rate = wav.length > 44 ? wav.readUInt32LE(24) : 0;
  const dataSize = wav.length > 44 ? wav.readUInt32LE(40) : 0;
  const seconds = rate ? dataSize / 2 / rate : 0;
  const segments = [];
  for (let t = 0; t + 0.5 < seconds; t += 2.5)
    segments.push({ start: +t.toFixed(2), end: +(t + 2.5).toFixed(2), text: 'Hello, this is a fake caption from local ASR.' });
  console.log(`[fake-asr] wav=${wav.length > 0} ${rate}Hz audio=${seconds.toFixed(1)}s segments=${segments.length}`);
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ text: segments.map(s => s.text).join(' '), segments }));
}).listen(8766, '127.0.0.1', () => console.log('fake ASR: http://127.0.0.1:8766'));
```

配置：识别方式选**自定义 OpenAI 兼容 ASR**，接口端点填 `http://127.0.0.1:8766`，Key 留空，模型随便填。

> 本项目的 A1 就是用这条路径验证的：假端点收到 6 个 **256,405 字节**的上传，头部为 `16000Hz / 1ch / 16bit`，并在页面浮层上显示出双语字幕（见 §14）。

### 13.6 排错对照表

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| 设置页「测试」返回 `undefined` / 什么都没发生 | **Service Worker 还在跑旧脚本** | 重新构建后按 §13.1 让扩展重新加载（**别删整个 `Service Worker` 目录，会连模型一起删**） |
| 模型下载报 `Failed to fetch` | 权重被 302 到 `us.aws.cdn.hf.co`（部分网络不可达） | 模型来源换 **ModelScope**（revision=`master`）或 hf-mirror |
| 模型下载 429 | hf-mirror 限流 | 换 ModelScope，或等几分钟再试 |
| `no available backend found ... ort-wasm-*.mjs` | ORT 去 CDN 拉 dev 版加载器失败 | 确认 `pnpm build` 跑过 `copy-ort`（`public/ort/` 有 13.6MB wasm），且扩展已重新加载 |
| `WebAssembly.instantiate(): violates CSP` | MV3 默认 CSP 不放行 wasm 编译 | 确认 manifest 里有 `content_security_policy.extension_pages` 且含 `'wasm-unsafe-eval'` |
| 本地字幕满屏重复同一句 | Whisper 在静音/音乐段幻觉 | 调高 `asr.capture.silenceRms`（如 0.01）、指定识别语言、换 base/small 模型 |
| 视频播放但没有任何提示 | `asr.enabled=false`；或该视频**有**字幕轨（走 track 翻译）；或时长超过 `maxDurationMin` | 检查开关；看 `video.textTracks.length` |
| 一直显示「等待音频…点击视频任意位置以开始识别」 | 自动播放策略把 AudioContext 停在 `suspended` | 点一下视频画面 |
| 提示「没有采集到声音」 | 音频被 CORS 污染（直连跨域 mp4）或站点静音 | 见方案 §3.2 降级 R3；或改用云端（同样取不到音频时需 R3） |
| `ASR 鉴权失败（HTTP 401/403）` | Key 错误/欠费/区域限制 | 换 Key 或换 provider |
| `ASR 触发限流（HTTP 429）` | 免费额度用尽 | 等退避或换 provider / 开 `fallbackOrder` |
| `ASR 请求超时（120000ms）` | 长音频 + 慢网络 | 调小 `asr.cloud.chunkMinutes`、调大 `asr.cloud.timeoutMs` |
| 字幕只有原文没有译文 | 翻译服务失败 | 看 `subtitle.service`（字幕翻译服务）；本地/云 ASR 共用该设置 |
| 识别结果乱（幻觉、重复） | 音乐/噪声导致 Whisper 幻觉 | 指定 `language`、调大静音阈值、开启"字幕专注于对话内容" |

### 13.7 安全与隐私

- **API Key 存 `storage.local`**，不进 `storage.sync`、不进配置导出（`ImportExport` 会剔除）。
- 云端 provider 只上传**抽取出的音频**（WAV），不上传视频、页面 URL、账号信息。
- 本地 provider（A2）全程不出网；模型文件存 CacheStorage，可一键删除。
- 关闭总开关后：不建 `AudioContext`、不读音频、不发请求（DevTools 可验证零网络）。

### 13.8 配置示例（可直接粘进「导入配置」）

**纯云端（Groq）**

```json
{ "asr": {
  "enabled": true,
  "provider": "groq-whisper",
  "auto": { "whenNoTrack": true, "minWatchSeconds": 10, "maxDurationMin": 15 },
  "capture": { "windowSec": 30, "strideSec": 5, "captureRate": 1 },
  "cloud": { "provider": "groq-whisper", "endpoint": "", "apiKey": "", "model": "whisper-large-v3-turbo",
             "language": "auto", "chunkMinutes": 10, "timeoutMs": 120000,
             "fallbackOrder": ["openai-whisper"] },
  "pipeline": { "translate": true, "service": "inherit", "displayMode": "inherit" },
  "cache": { "enabled": true, "ttlDays": 30 }
} }
```

**自建服务（内网，无 Key）**

```json
{ "asr": {
  "enabled": true,
  "provider": "whisper-cpp-server",
  "cloud": { "provider": "whisper-cpp-server", "endpoint": "http://192.168.1.10:8080",
             "apiKey": "", "model": "base", "language": "auto",
             "chunkMinutes": 10, "timeoutMs": 180000, "fallbackOrder": [] },
  "pipeline": { "translate": true, "service": "inherit", "displayMode": "inherit" }
} }
```

**本地 Whisper（A2 可用后生效；现在填了也不会报错，只是该 provider 未注册）**

```json
{ "asr": {
  "enabled": true,
  "provider": "auto",
  "capture": { "windowSec": 30, "strideSec": 5, "captureRate": 1 },
  "local": { "model": "whisper-base", "dtype": "q8", "numThreads": 1,
             "progressive": true, "modelBaseUrl": "" },
  "pipeline": { "translate": true, "service": "inherit", "displayMode": "inherit" }
} }
```

---

## 14. 实现状态与落地记录

### 14.1 A1 已完成（2026-11-09）

| 模块 | 文件 | 状态 |
| --- | --- | --- |
| 配置树 | `src/core/config/defaults.ts`（`asr.*`） | ✅ |
| 类型/错误 | `src/core/asr/types.ts` | ✅ |
| Provider 注册表（能力表驱动 UI） | `src/core/asr/registry.ts` | ✅ |
| OpenAI / Groq / whisper.cpp / 自定义（同协议） | `src/core/asr/providers/openai-asr.ts` | ✅ |
| Deepgram（异协议） | `src/core/asr/providers/deepgram.ts` | ✅ |
| WAV 编码 / base64 传输 | `src/core/asr/audio/{wav,codec}.ts` | ✅ |
| 结果缓存（音频指纹键 + TTL） | `src/core/asr/cache.ts` | ✅ |
| 消息协议 `asr:transcribe / asr:test / asr:cache:clear` | `src/core/messaging/protocol.ts`、`background.ts` | ✅ |
| 音频采集（R1） | `src/engine/asrAudioTap.ts` | ✅ |
| 双语浮层 | `src/engine/captionLayer.ts` + `content.css` | ✅ |
| 会话编排（窗口/去重/翻译/渲染） | `src/engine/asrSession.ts` | ✅ |
| 设置页 ASR 分区 | `src/entrypoints/options/pages/Subtitle.vue` | ✅ |
| 单测（16 项） | `src/core/asr/asr.test.ts`、`audio/wav.test.ts` | ✅ 66/66 全绿 |

### 14.2 真机验证记录（x.com 无字幕视频）

用 §13.5 的假端点跑通，证据：

```
[fake-asr] #3..8  bytes=256405  wav=true  16000Hz/1ch/16bit  audio=8.0s  segments=3
```

页面浮层实测：

| 字段 | 值 |
| --- | --- |
| 原文 | `I feel like there were a lot of things we could have done better this year.` |
| 译文 | `我觉得今年我们可以做得更好的事情有很多。` |
| 位置/样式 | 视频内下方居中、`display:block`，原文白字 + 译文浅黄字，黑底半透明 |

即：**采集 → WAV(16k/mono/16bit) → 上传 → 解析 segments → 批量翻译 → 浮层按时间轴显示** 全链路打通。

### 14.2 A2 已完成：本地 Whisper（2026-11-09）

| 模块 | 文件 | 状态 |
| --- | --- | --- |
| 本地推理引擎（offscreen） | `src/entrypoints/offscreen/asrLocal.ts` | ✅ |
| 本地 provider（background 侧转发 + 模型管理） | `src/core/asr/providers/local-whisper.ts` | ✅ 已注册进 `IMPLEMENTED` |
| 模型下载源可配置（HF / ModelScope / hf-mirror / 内网） | `asr.local.modelBaseUrl` + `modelRevision` | ✅ |
| ORT wasm 随包分发 | `scripts/copy-ort.mjs`（prebuild）+ `scripts/prune-ort.mjs`（postbuild） | ✅ |
| MV3 CSP 放开 wasm 编译 | `wxt.config.ts` → `content_security_policy.extension_pages` | ✅ |
| 幻觉抑制 | `asr.capture.silenceRms` 门限 + `cleanRepeated()` 复读压缩 + Whisper `no_speech_threshold` | ✅ |
| 设置页本地分区（预设/下载/进度/删除） | `Subtitle.vue` | ✅ |
| 单测 | `asrSession.test.ts`（复读压缩）、`wav.test.ts`（WAV 往返） | ✅ 71/71 |

**真机验证（x.com 无字幕视频，whisper-tiny q8 + ModelScope）**：

```
模型下载 → status: ready
视频播放 → 浮层：I hope you guys enjoy it.  /  希望你们玩得开心。
```

即：**模型下载（ModelScope）→ ORT wasm 编译 → 本地推理 → cue 解析 → 翻译 → 双语浮层** 全链路打通，全程零云端请求。

### 14.3 待办（A3 起）

- **A2**：本地 Whisper（transformers.js + 模型下载/管理 + 单线程推理），注册进 `registry.ts` 的 `IMPLEMENTED`
- **A3**：无轨提示条、播放器「译」按钮（手动触发）、`tiny→base` 渐进替换、AudioWorklet 替代 ScriptProcessor
- **A4**：R3 整片取流（performance → m3u8 → mp4box → WebCodecs）、DRM 拒绝、`chunkMinutes` 超长切片、按 `fallbackOrder` 的 UI 排序
- 已知限制：`capture.windowSec` 是全局的（本地/云共用）；`captureRate` 已入配置但尚未接线（A3）；字幕位置可拖拽（A3）

---

*方案版本 v1.2 · 2026-11-09 · §13 配置指南与 §14 落地记录基于 A1 真实联调；A0 探测见附录 A*
