import type { UserConfig } from '@/core/config/defaults';
import { fnv1a, normalizeText } from '@/core/shared/utils';
import { getAdapter, listServices } from './registry';
import type { CacheArea } from './cache';

/**
 * 划词 AI 搜索（选中文字的中文解释）
 * - 与段落 AI 搜索（explain）同管线：AI 服务 + systemOverride + 缓存（explain: 前缀）
 * - 差异：提示词面向「选中的词/短语/句子」——解释含义 + 语境背景 + 用法，输出中文
 * - 缓存 key 加 s 前缀区分：同一段文本的「段落解释」与「划词解释」互不污染
 */

/**
 * 划词解释提示词：
 * - 输入是网页中选中的词/短语/句子（可能为外文）
 * - 输出简体中文的解释（含义 / 语境 / 背景 / 用法），分点简短
 * - 术语类以「原词：」开头，便于对照学习
 */
export const SELECTION_SEARCH_SYSTEM_PROMPT = `You are a bilingual dictionary, encyclopedia and reading assistant.
The user sends a short excerpt (a word, a phrase, or one sentence, usually in a foreign language) that they selected while reading a web page.
Explain it in {{to}} for a general reader:
- If it is a term, phrase or idiom, start with the original excerpt followed by "：" (a full-width colon).
- Explain its meaning in this context, plus useful background, usage notes, or related concepts.
- 2-4 short bullet points, total about 100-250 Chinese characters, plain language.
Output ONLY the explanation text. No preamble, no markdown headers, no extra commentary.`;

/** 划词解释缓存 key：service 维度 + 文本哈希（s 前缀与段落解释区分） */
export function selectionSearchCacheKey(serviceId: string, text: string): string {
  return `explain:${serviceId}:s${fnv1a(normalizeText(text))}`;
}

export interface SelectionSearchResult {
  content: string;
  cached: boolean;
}

export interface SelectionSearchDeps {
  loadConfig: () => Promise<UserConfig>;
  area: CacheArea;
}

function fill(template: string, params: Record<string, string>): string {
  return template.replaceAll(/\{\{(\w+)\}\}/g, (_, k: string) => params[k] ?? '');
}

/** 解析划词搜索服务：selection.aiSearchService →（inherit）→ explain.service →（inherit）→ general.service */
export function resolveSelectionSearchService(config: UserConfig): string {
  if (config.selection.aiSearchService !== 'inherit') return config.selection.aiSearchService;
  return config.explain.service === 'inherit' ? config.general.service : config.explain.service;
}

/** 划词 AI 搜索：先查缓存（未过期直接返回），否则调 AI 并写缓存 */
export async function searchSelection(
  deps: SelectionSearchDeps,
  text: string,
): Promise<SelectionSearchResult> {
  const normalized = normalizeText(text);
  if (!normalized) throw new Error('未选中可解释的文字');
  const config = await deps.loadConfig();
  const serviceId = resolveSelectionSearchService(config);
  // 机翻通道无解释能力（忽略提示词，只会再翻译一遍）：诚实报错引导配置
  const svc = listServices(config).find((s) => s.id === serviceId);
  if (svc && svc.kind !== 'ai') {
    throw new Error('划词 AI 搜索需要 AI 翻译服务（机翻通道无法解释）。请在「设置 → 划词翻译」指定 AI 服务');
  }
  const adapter = getAdapter(config, serviceId);
  const key = selectionSearchCacheKey(serviceId, normalized);
  const cacheMs = config.explain.cacheDays * 24 * 60 * 60 * 1000;

  // 1. 缓存命中（未过期）
  if (cacheMs > 0) {
    try {
      const stored = await deps.area.get([key]);
      const raw = stored[key];
      if (raw) {
        const rec = JSON.parse(raw) as { c?: string; t?: number };
        if (rec?.c && rec.t && Date.now() - rec.t < cacheMs) {
          return { content: rec.c, cached: true };
        }
      }
    } catch {
      // 缓存损坏视为未命中
    }
  }

  // 2. 调 AI（systemOverride 整体替换翻译指令为划词解释指令；固定输出简体中文）
  const out = await adapter.translate([normalized], 'auto', '简体中文', {
    systemOverride: fill(SELECTION_SEARCH_SYSTEM_PROMPT, { to: '简体中文' }),
  });
  const content = out[0]?.trim() ?? '';
  if (!content) throw new Error('AI 未返回解释内容');

  // 3. 写缓存
  if (cacheMs > 0) {
    await deps.area
      .set({ [key]: JSON.stringify({ c: content, t: Date.now() }) })
      .catch(() => undefined);
  }
  return { content, cached: false };
}