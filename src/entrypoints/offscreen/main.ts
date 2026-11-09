/**
 * Offscreen Document：本地重计算集中地
 * - OCR（tesseract.js，资源复用 public/tesseract/*）
 * - 本地 Whisper 语音识别（transformers.js + ONNX Runtime Web，A2）
 *
 * 为什么放这里：MV3 Service Worker 不能跑长时间 CPU 任务、没有 DOM/Worker 便利；
 * offscreen 有完整页面环境，适合 wasm 推理。
 */
import Tesseract from 'tesseract.js';
import { base64ToArrayBuffer, type AsrCue } from '@/core/asr';
import {
  checkModelCached,
  configureEngine,
  downloadModel,
  removeModel,
  transcribeLocal,
} from './asrLocal';

let worker: Awaited<ReturnType<typeof Tesseract.createWorker>> | null = null;

async function getWorker() {
  if (!worker) {
    worker = await Tesseract.createWorker('eng', 1, {
      // public/ 下的静态资源（复用原版打包文件），路径不在 WXT 生成的 PublicPath 类型中，需显式放宽
      workerPath: browser.runtime.getURL('tesseract/worker.min.js' as never),
      corePath: browser.runtime.getURL('tesseract/tesseract-core-simd-lstm.wasm.js' as never),
      langPath: 'https://tessdata.projectnaptha.com/4.0.0',
      logger: () => undefined,
    });
  }
  return worker;
}

interface OffscreenMessage {
  type?: string;
  payload?: {
    dataUrl?: string;
    action?: 'status' | 'download' | 'remove';
    model?: string;
    dtype?: string;
    modelBaseUrl?: string;
    modelRevision?: string;
    wavBase64?: string;
    language?: string;
    windowSec?: number;
    strideSec?: number;
  };
}

browser.runtime.onMessage.addListener((raw: unknown) => {
  const msg = raw as OffscreenMessage;
  if (!msg?.type) return;

  if (msg.type === 'offscreen:ping') {
    return Promise.resolve({ type: 'offscreen:pong' });
  }

  if (msg.type === 'ocr:image') {
    return (async () => {
      const dataUrl = msg.payload?.dataUrl;
      if (!dataUrl) throw new Error('ocr:image 缺少 dataUrl');
      const w = await getWorker();
      const result = await w.recognize(dataUrl);
      return { text: result.data.text ?? '' };
    })();
  }

  /* ---------- 本地 Whisper（A2） ---------- */
  if (msg.type === 'asr:local:model') {
    const { action = 'status', model = 'whisper-base' } = msg.payload ?? {};
    return (async () => {
      if (action === 'download') {
        configureEngine(msg.payload?.modelBaseUrl ?? '', msg.payload?.modelRevision);
        // 下载是长任务：立即返回 downloading，后台继续跑，设置页轮询 status
        void downloadModel(model, msg.payload?.dtype ?? 'q8').catch(() => undefined);
        return { status: 'downloading', ratio: 0 };
      }
      if (action === 'remove') {
        await removeModel(model);
        return { status: 'absent' };
      }
      // status：先看内存，再看 CacheStorage（重启后内存状态会丢）
      return checkModelCached(
        model,
        msg.payload?.dtype ?? 'q8',
        msg.payload?.modelBaseUrl ?? '',
        msg.payload?.modelRevision ?? '',
      );
    })();
  }

  if (msg.type === 'asr:local:transcribe') {
    return (async () => {
      const p = msg.payload;
      if (!p?.wavBase64) return { ok: false, code: 'bad-request', message: '缺少音频数据' };
      try {
        configureEngine(p.modelBaseUrl ?? '', p.modelRevision);
        const cues: AsrCue[] = await transcribeLocal(base64ToArrayBuffer(p.wavBase64), {
          model: p.model ?? 'whisper-base',
          dtype: p.dtype ?? 'q8',
          language: p.language,
          windowSec: p.windowSec ?? 30,
          strideSec: p.strideSec ?? 5,
        });
        return { ok: true, cues };
      } catch (e) {
        return { ok: false, code: 'local-error', message: (e as Error).message };
      }
    })();
  }

  // 其它消息（config:changed 等）不属于 offscreen，忽略
  return undefined;
});

console.log('[imt-rebuild] offscreen ready（OCR + 本地 Whisper）');
