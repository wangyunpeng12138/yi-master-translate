/**
 * ASR（语音转字幕）内核类型
 * 方案：docs/ASR字幕接入方案.md
 * 约定：provider 只负责「音频 → cue 数组」，翻译与渲染由既有字幕管线承担。
 */

export type AsrProviderId =
  | 'local-whisper' // 本地 transformers.js（A2 落地）
  | 'openai-whisper' // OpenAI /v1/audio/transcriptions
  | 'groq-whisper' // Groq（OpenAI 兼容，速度快）
  | 'deepgram' // Deepgram /v1/listen
  | 'whisper-cpp-server' // 自建 whisper.cpp server（/inference）
  | 'custom-openai-asr'; // 任意 OpenAI 兼容 ASR 端点（末班车）

export interface AsrCue {
  start: number; // 秒（相对音频起点）
  end: number;
  text: string;
}

/** provider 能力描述：设置页 UI 完全由它驱动，新增 provider 不需要改页面 */
export interface AsrCapabilities {
  kind: 'local' | 'cloud';
  needsKey: boolean;
  needsEndpoint: boolean;
  offline: boolean;
  supportsTimestamps: boolean;
  /** 单次音频上限（秒）；0 = 不限（由窗口切分控制） */
  maxAudioSec: number;
  /** 可选模型（空数组 = 用 endpoint 默认） */
  models: string[];
  langs: 'auto' | string[];
  /** 默认端点（endpoint 留空时使用） */
  defaultEndpoint?: string;
  /** 明确要求音频格式 */
  audioFormat?: 'wav' | 'raw';
}

export interface AsrRequest {
  /** 16kHz 单声道 16bit PCM 的 WAV 字节 */
  wav: ArrayBuffer;
  /** 音频起点在视频时间轴上的偏移（秒），用于把 cue 对齐回视频 */
  offsetSec: number;
  durationSec: number;
  language: string; // 'auto' | 'en' | 'zh' ...
  signal?: AbortSignal;
}

export interface AsrProvider {
  id: AsrProviderId;
  name: string;
  capabilities: AsrCapabilities;
  /** 返回相对音频起点的 cue（offsetSec 由调用方叠加） */
  transcribe(req: AsrRequest): Promise<AsrCue[]>;
}

export class AsrError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'no-provider' // 没有任何可用 provider（未配置）
      | 'no-key'
      | 'auth'
      | 'quota'
      | 'http'
      | 'parse'
      | 'timeout'
      | 'aborted'
      | 'unsupported',
  ) {
    super(message);
    this.name = 'AsrError';
  }
}
