import type { ServiceId } from '@/core/shared/types';

/** 服务定义（注册表静态信息） */
export interface ServiceDefinition {
  id: ServiceId;
  name: string;
  kind: 'machine' | 'ai';
  builtin: boolean;
  /** 单次请求允许的最大段落数（受上游接口限制） */
  batchLimit: number;
  /** 默认每秒最大请求数（用户可配） */
  defaultMaxRps: number;
  needsKey?: boolean;
  needsSetup?: boolean;
}

/** 翻译适配器选项 */
export interface AdapterOptions {
  /** 术语（按启用术语库展开） */
  terms?: Array<{ from: string; to: string }>;
  /** AI 专家系统提示词 */
  expertPrompt?: string;
  /** 用户全局追加提示词（ai.promptAppend，注入 system 末尾；仅 AI 服务生效） */
  promptAppend?: string;
  /** 温度等自定义服务参数 */
  temperature?: number;
  /** signal 用于取消 */
  signal?: AbortSignal;
}

/** 适配器接口：texts 与返回数组必须等长对齐 */
export interface ServiceAdapter {
  id: string;
  batchLimit: number;
  maxRps: number;
  translate(texts: string[], from: string, to: string, opts?: AdapterOptions): Promise<string[]>;
}

export class ServiceError extends Error {
  constructor(
    message: string,
    public readonly code: 'no-key' | 'http' | 'parse' | 'rate-limit' | 'unknown',
  ) {
    super(message);
  }
}
