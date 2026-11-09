import type { TranslateRequest, TranslateResult } from '@/core/shared/types';
import type { UserConfig } from '@/core/config/defaults';
import type { AsrCue, AsrProviderId } from '@/core/asr/types';

/**
 * 消息协议（单文件类型定义，UI / background / content 三端共用）
 * P0：command 广播；P2 起 translate:batch；A1 起 asr:*（无字幕视频语音识别）
 * 请求-响应通过 sendMessage 返回值实现。
 */

/** ASR 转写结果：失败也用结构化返回，避免 content 侧只能拿到裸字符串错误 */
export type AsrTranscribeResult =
  | { ok: true; cues: AsrCue[]; provider: AsrProviderId; cached: boolean }
  | { ok: false; code: string; message: string };

export type AsrTestResult =
  | { ok: true; provider: AsrProviderId; ms: number; cueCount: number }
  | { ok: false; code: string; message: string };

/** 请求-响应型消息 */
export interface RequestMap {
  'config:get': { res: UserConfig };
  'config:set': { req: { patch: Partial<UserConfig> }; res: { ok: true } };
  'translate:batch': { req: TranslateRequest; res: TranslateResult };
  'cache:query': { req: { keys: string[] }; res: { hits: Record<string, string> } };
  'ocr:image': { req: { dataUrl: string }; res: { text: string } };
  'offscreen:ping': { res: { type: 'offscreen:pong' } };
  /** 音频转写（音频以 base64 传输，见 core/asr/audio/codec.ts） */
  'asr:transcribe': {
    req: {
      wavBase64: string;
      offsetSec: number;
      durationSec: number;
      language?: string;
      /** 指定 provider（'auto' = 按配置链） */
      provider?: 'auto' | AsrProviderId;
    };
    res: AsrTranscribeResult;
  };
  /** 连通性/配置自检：用 0.3s 静音探测第一个可用 provider */
  'asr:test': { req: { provider?: 'auto' | AsrProviderId }; res: AsrTestResult };
  'asr:cache:clear': { req: {}; res: { removed: number } };
  /** 本地模型管理（status 轮询 / download 触发 / remove 删除） */
  'asr:model': {
    req: { action: 'status' | 'download' | 'remove'; model?: string };
    res: { status: 'absent' | 'downloading' | 'ready' | 'error'; ratio?: number; sizeMB?: number; error?: string };
  };
}

/** 事件广播型消息（background → content / UI） */
export interface EventMap {
  command: { command: string };
  'config:changed': { config: UserConfig };
  'translation:status': { state: 'idle' | 'translating' | 'done' | 'error'; detail?: string };
  /** ASR 进度（识别中提示用） */
  'asr:progress': { stage: 'capture' | 'upload' | 'infer' | 'translate' | 'done'; ratio?: number };
}

export type RequestType = keyof RequestMap;
export type EventType = keyof EventMap;

export interface RequestMessage<T extends RequestType> {
  type: T;
  payload: RequestMap[T] extends { req: infer R } ? R : undefined;
}

export interface EventMessage<T extends EventType> {
  type: T;
  payload: EventMap[T];
}

export function isRequestType(t: string): t is RequestType {
  return [
    'config:get',
    'config:set',
    'translate:batch',
    'cache:query',
    'ocr:image',
    'offscreen:ping',
    'asr:transcribe',
    'asr:test',
    'asr:cache:clear',
    'asr:model',
  ].includes(t);
}
