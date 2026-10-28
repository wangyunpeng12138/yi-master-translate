import type { TranslateRequest, TranslateResult } from '@/core/shared/types';
import type { UserConfig } from '@/core/config/defaults';

/**
 * 消息协议（单文件类型定义，UI / background / content 三端共用）
 * P0：command 广播；P2 起 translate:batch；请求-响应通过 sendMessage 返回值实现。
 */

/** 请求-响应型消息 */
export interface RequestMap {
  'config:get': { res: UserConfig };
  'config:set': { req: { patch: Partial<UserConfig> }; res: { ok: true } };
  'translate:batch': { req: TranslateRequest; res: TranslateResult };
  'cache:query': { req: { keys: string[] }; res: { hits: Record<string, string> } };
  'ocr:image': { req: { dataUrl: string }; res: { text: string } };
  'offscreen:ping': { res: { type: 'offscreen:pong' } };
}

/** 事件广播型消息（background → content / UI） */
export interface EventMap {
  command: { command: string };
  'config:changed': { config: UserConfig };
  'translation:status': { state: 'idle' | 'translating' | 'done' | 'error'; detail?: string };
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
  return ['config:get', 'config:set', 'translate:batch', 'cache:query', 'ocr:image', 'offscreen:ping'].includes(t);
}
