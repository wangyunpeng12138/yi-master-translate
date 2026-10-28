/**
 * 共享类型定义（多上下文通用）
 */

/** BCP-47 简化语言码（与原版翻译服务语言参数对齐） */
export type LangCode = string;

/** 翻译服务 ID（对齐原版服务注册表命名） */
export type ServiceId = string;

/** 翻译作用域 */
export type TranslateScope = 'page' | 'subtitle' | 'input' | 'selection' | 'hover' | 'manga' | 'text';

/** 翻译请求 */
export interface TranslateRequest {
  texts: string[];
  from: LangCode;
  to: LangCode;
  service: ServiceId;
  scope: TranslateScope;
}

/** 翻译结果（与 texts 等长对齐） */
export interface TranslateResult {
  texts: string[];
}

/** 站点翻译模式（popup「当前网站翻译设置」三态） */
export type SiteTranslateMode = 'global' | 'always' | 'never';

/** 显示模式：双语 / 仅译文 */
export type DisplayMode = 'dual' | 'only';

/** 译文相对原文位置 */
export type TranslationPosition = 'before' | 'after';

/** 悬浮球点击行为 */
export type FloatBallClickType = 'translate' | 'panel';

/** AI 专家角色 */
export interface AiExpert {
  id: string;
  name: string;
  prompt: string;
  builtin?: boolean;
}

/** 术语条目 */
export interface TermEntry {
  from: string;
  to: string;
  caseSensitive?: boolean;
}

/** 术语库 */
export interface TermLibrary {
  id: string;
  name: string;
  enabled: boolean;
  builtin?: boolean;
  terms: TermEntry[];
}

/** 自定义 AI 服务（openai-compatible 槽位） */
export interface CustomAiService {
  id: string; // 如 openai-custom / claude-custom
  name: string;
  apiKey: string;
  apiUrl: string;
  model: string;
  temperature: number;
  maxRps: number;
  systemPrompt?: string;
  userPrompt?: string;
  requestBodyTemplate?: string;
  richText?: boolean;
}
