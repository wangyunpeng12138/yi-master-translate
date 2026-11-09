import type { UserConfig } from '@/core/config/defaults';
import { arrayBufferToBase64 } from '../audio/codec';
import { AsrError, type AsrCue, type AsrProvider, type AsrRequest } from '../types';

/**
 * 本地 Whisper provider（A2）
 * - 推理本体在 offscreen document（那里才能跑 wasm 长任务），这里只做转发与状态查询
 * - 模型未下载时**快速失败**，让 `fallbackOrder` 立刻切到云端，而不是把首条字幕拖几分钟
 * - 模型下载由设置页显式触发（`asr:model` / action=download），下载进度靠轮询
 */

export type LocalModelName = 'whisper-tiny' | 'whisper-base' | 'whisper-small';

export interface LocalModelState {
  status: 'absent' | 'downloading' | 'ready' | 'error';
  ratio?: number;
  sizeMB?: number;
  error?: string;
}

async function askOffscreen<T>(type: string, payload: unknown, retries = 3): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < retries; i++) {
    try {
      const res = (await browser.runtime.sendMessage({ type, payload })) as T | undefined;
      if (res !== undefined) return res;
      lastErr = new Error('offscreen 返回空值');
    } catch (e) {
      lastErr = e;
    }
    await new Promise((r) => setTimeout(r, 150 + i * 200));
  }
  throw new AsrError(
    `本地识别引擎未响应（offscreen 未就绪）：${(lastErr as Error)?.message ?? '未知'}`,
    'unsupported',
  );
}

export async function localModelStatus(
  config: UserConfig,
  model = config.asr.local.model,
  dtype = config.asr.local.dtype,
): Promise<LocalModelState> {
  try {
    return await askOffscreen<LocalModelState>('asr:local:model', {
      action: 'status',
      model,
      dtype,
      modelBaseUrl: config.asr.local.modelBaseUrl,
      modelRevision: config.asr.local.modelRevision,
    });
  } catch {
    return { status: 'absent' };
  }
}

/** 触发下载（立即返回 downloading，实际下载在 offscreen 后台进行） */
export async function startModelDownload(config: UserConfig): Promise<LocalModelState> {
  return askOffscreen<LocalModelState>('asr:local:model', {
    action: 'download',
    model: config.asr.local.model,
    dtype: config.asr.local.dtype,
    modelBaseUrl: config.asr.local.modelBaseUrl,
    modelRevision: config.asr.local.modelRevision,
  });
}

export async function removeLocalModel(config: UserConfig): Promise<LocalModelState> {
  return askOffscreen<LocalModelState>('asr:local:model', {
    action: 'remove',
    model: config.asr.local.model,
  });
}

export function createLocalWhisperProvider(config: UserConfig): AsrProvider {
  const local = config.asr.local;
  return {
    id: 'local-whisper',
    name: '本地 Whisper',
    capabilities: {
      kind: 'local',
      needsKey: false,
      needsEndpoint: false,
      offline: true, // 模型下载完成后完全离线
      supportsTimestamps: true,
      maxAudioSec: 0, // 由采集窗口切分控制
      models: ['whisper-tiny', 'whisper-base', 'whisper-small'],
      langs: 'auto',
      audioFormat: 'wav',
    },
    async transcribe(req: AsrRequest): Promise<AsrCue[]> {
      const st = await localModelStatus(config, local.model);
      if (st.status !== 'ready') {
        throw new AsrError(
          st.status === 'downloading'
            ? '本地模型仍在下载中，请稍候'
            : '本地模型未下载（设置页 → 视频字幕 → 下载模型）',
          'unsupported',
        );
      }
      const res = await askOffscreen<{ ok: boolean; cues?: AsrCue[]; message?: string; code?: string }>(
        'asr:local:transcribe',
        {
          wavBase64: arrayBufferToBase64(req.wav),
          model: local.model,
          dtype: local.dtype,
          language: req.language,
          windowSec: config.asr.capture.windowSec,
          strideSec: config.asr.capture.strideSec,
          modelBaseUrl: local.modelBaseUrl,
          modelRevision: local.modelRevision,
        },
      );
      if (!res?.ok) throw new AsrError(res?.message ?? '本地识别失败', (res?.code as never) ?? 'unsupported');
      return res.cues ?? [];
    },
  };
}
