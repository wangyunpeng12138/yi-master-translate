import { env, pipeline } from '@huggingface/transformers';
import { wavToFloat32, type AsrCue } from '@/core/asr';

/**
 * 本地 Whisper 推理（跑在 offscreen document 里）
 *
 * 选型：transformers.js（ONNX Runtime Web / wasm 后端）
 * - 模型按需从 HuggingFace 下载，权重落 CacheStorage（二次使用不再下载）
 * - `numThreads: 1`：扩展页默认 `crossOriginIsolated=false`，多线程 wasm 不保证可用（A0 实测 SAB 可构造，但保守起见单线程）
 * - 单飞：同一时刻只跑一个推理，避免抢 CPU 反而更慢
 */

export interface LocalModelInfo {
  status: 'absent' | 'downloading' | 'ready' | 'error';
  ratio?: number;
  error?: string;
  sizeMB?: number;
}

/** 已下载模型的运行时状态（进度供设置页轮询） */
const state = new Map<string, LocalModelInfo>();
let currentPipe: { model: string; dtype: string; pipe: unknown } | null = null;
let busy = false;

function modelId(model: string): string {
  return model.startsWith('onnx-community/') ? model : `onnx-community/${model}`;
}

/** 当前模型源配置（configureEngine 设置） */
let engineRevision = 'main';

/**
 * 允许把模型源指向镜像/内网（asr.local.modelBaseUrl / modelRevision）
 * - HuggingFace 官方：https://huggingface.co                + revision=main
 * - hf-mirror     ：https://hf-mirror.com                    + revision=main
 * - ModelScope    ：https://www.modelscope.cn/models         + revision=master
 * - 自建静态目录   ：https://your.cdn/whisper  (目录需按 {model}/resolve/{revision}/ 摆放)
 */
export function configureEngine(modelBaseUrl: string, revision?: string): void {
  env.allowLocalModels = false;
  env.useBrowserCache = true;
  engineRevision = revision?.trim() || 'main';
  // 单线程：扩展页默认 crossOriginIsolated=false，多线程 wasm 不保证可用（A0 实测 SAB 可构造但保守处理）
  try {
    const wasm = env.backends?.onnx?.wasm;
    if (wasm) {
      wasm.numThreads = 1;
      // ORT 默认会去 jsDelivr 动态 import 与当前 dev 版本匹配的 .mjs（线上 404），
      // 这里钉到扩展自带的文件（由 scripts/copy-ort.mjs 在构建前拷进 public/ort/）
      wasm.wasmPaths = {
        mjs: browser.runtime.getURL('ort/ort-wasm-simd-threaded.mjs' as never),
        wasm: browser.runtime.getURL('ort/ort-wasm-simd-threaded.wasm' as never),
      } as never;
    }
  } catch {
    /* 老版本没有该字段时忽略 */
  }
  if (modelBaseUrl) {
    env.remoteHost = modelBaseUrl.replace(/\/+$/, '');
    env.remotePathTemplate = '{model}/resolve/{revision}/';
  }
}

async function getPipe(
  model: string,
  dtype: string,
  onProgress?: (ratio: number, sizeMB?: number) => void,
): Promise<unknown> {
  if (currentPipe && currentPipe.model === model && currentPipe.dtype === dtype) return currentPipe.pipe;

  const id = modelId(model);
  const info: LocalModelInfo = { status: 'downloading', ratio: 0 };
  state.set(model, info);

  const pipe = await pipeline('automatic-speech-recognition', id, {
    dtype: dtype as 'q8' | 'fp16' | 'fp32',
    device: 'wasm',
    revision: engineRevision,
    progress_callback: (p: { status?: string; loaded?: number; total?: number; file?: string }) => {
      if (p.status === 'progress' && p.total) {
        const ratio = Math.min(1, (p.loaded ?? 0) / p.total);
        info.ratio = ratio;
        onProgress?.(ratio, p.total / 1024 / 1024);
      }
    },
  });

  currentPipe = { model, dtype, pipe };
  state.set(model, { status: 'ready', ratio: 1 });
  return pipe;
}

/** 预先下载/加载模型（设置页「下载模型」按钮） */
export async function downloadModel(
  model: string,
  dtype: string,
  onProgress?: (ratio: number) => void,
): Promise<LocalModelInfo> {
  try {
    await getPipe(model, dtype, onProgress);
    return state.get(model) ?? { status: 'ready' };
  } catch (e) {
    const info: LocalModelInfo = { status: 'error', error: (e as Error).message };
    state.set(model, info);
    return info;
  }
}

export function modelStatus(model: string): LocalModelInfo {
  const known = state.get(model);
  if (known) return known;
  if (currentPipe?.model === model) return { status: 'ready' };
  return { status: 'absent' };
}

/** dtype 对应的 ONNX 文件名后缀（transformers.js 的命名约定） */
function dtypeSuffix(dtype: string): string {
  if (dtype === 'q8') return '_quantized';
  if (dtype === 'fp16') return '_fp16';
  return '';
}

/**
 * 查磁盘缓存判断模型是否已下载。
 * 必要性：offscreen 每次浏览器启动都是新进程，内存里的 state 会丢；
 * 只看内存会把"已下载到 CacheStorage 的模型"误判为未下载，从而回退云端（实测踩过）。
 */
export async function checkModelCached(
  model: string,
  dtype = 'q8',
  baseUrl = '',
  revision = '',
): Promise<LocalModelInfo> {
  const memory = modelStatus(model);
  if (memory.status === 'ready') return memory;
  try {
    if (typeof caches === 'undefined') return memory;
    const host = (baseUrl || env.remoteHost || 'https://huggingface.co').replace(/\/+$/, '');
    const rev = revision?.trim() || engineRevision || 'main';
    const url = `${host}/${modelId(model)}/resolve/${rev}/onnx/encoder_model${dtypeSuffix(dtype)}.onnx`;
    const cache = await caches.open('transformers-cache');
    const hit = await cache.match(url);
    if (hit) {
      const ready: LocalModelInfo = { status: 'ready', ratio: 1 };
      state.set(model, ready);
      return ready;
    }
  } catch {
    /* CacheStorage 不可用/键不匹配时按未下载处理 */
  }
  return memory;
}

/** 删除模型缓存（CacheStorage 里该模型的所有文件） */
export async function removeModel(model: string): Promise<void> {
  const id = modelId(model);
  if (typeof caches === 'undefined') return;
  const names = await caches.keys();
  for (const name of names) {
    const cache = await caches.open(name);
    const keys = await cache.keys();
    for (const req of keys) {
      if (req.url.includes(id)) await cache.delete(req);
    }
  }
  if (currentPipe?.model === model) currentPipe = null;
  state.delete(model);
}

/** 推理：WAV → cue[]（相对音频起点） */
export async function transcribeLocal(
  wav: ArrayBuffer,
  opts: { model: string; dtype: string; language?: string; windowSec: number; strideSec: number },
): Promise<AsrCue[]> {
  if (busy) throw new Error('本地识别正在处理上一段音频，请稍后再试');
  busy = true;
  try {
    const { pcm, sampleRate } = wavToFloat32(wav);
    if (sampleRate !== 16_000) {
      throw new Error(`本地 Whisper 需要 16kHz 音频，收到 ${sampleRate}Hz`);
    }
    const pipe = (await getPipe(opts.model, opts.dtype)) as (
      audio: Float32Array,
      o: Record<string, unknown>,
    ) => Promise<{ text?: string; chunks?: Array<{ text?: string; timestamp?: [number, number | null] }> }>;

    const out = await pipe(pcm, {
      // 指定语言可减少误判；'auto' 交给模型
      ...(opts.language && opts.language !== 'auto' ? { language: opts.language } : {}),
      task: 'transcribe',
      return_timestamps: true,
      chunk_length_s: opts.windowSec,
      stride_length_s: opts.strideSec,
      // 抑制「幻觉」三件套：不带上下文、静音判定、压缩比异常时重试
      condition_on_previous_text: false,
      no_speech_threshold: 0.6,
      logprob_threshold: -1.0,
      compression_ratio_threshold: 2.4,
    });

    const chunks = out.chunks ?? [];
    if (chunks.length > 0) {
      return chunks
        .map((c, i) => ({
          start: Number(c.timestamp?.[0] ?? 0),
          // 部分模型末段没有 end 时间戳，用下一段起点或 +3s 兜底
          end: Number(c.timestamp?.[1] ?? chunks[i + 1]?.timestamp?.[0] ?? Number(c.timestamp?.[0] ?? 0) + 3),
          text: (c.text ?? '').trim(),
        }))
        .filter((c) => c.text.length > 0);
    }
    const text = (out.text ?? '').trim();
    return text ? [{ start: 0, end: pcm.length / sampleRate, text }] : [];
  } finally {
    busy = false;
  }
}
