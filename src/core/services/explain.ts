import type { UserConfig } from '@/core/config/defaults';
import { fnv1a, normalizeText } from '@/core/shared/utils';
import { getAdapter, listServices } from './registry';
import type { CacheArea } from './cache';

/**
 * AI 搜索（段落术语解释）
 * - 与翻译服务分离：机翻接口快但不能解释术语，AI 搜索用独立服务配置（config.explain.service）
 * - 缓存：按段落文本 + 服务哈希，存 {内容, 生成时间}，cacheDays 过期（0 = 不缓存）
 * - 导出：扫描全部解释缓存组装 txt（术语复盘学习）
 */

/**
 * 术语解释提示词（通用内置，小白科普向）：
 * - 识别段落内的领域术语/行话/典故/专有名词
 * - 每项 2-3 句通俗解释，输出「术语：解释」逐行格式
 * - 无可解释项时给出 2 句段落大意（保证总有产出）
 */
export const EXPLAIN_SYSTEM_PROMPT = `You are a friendly knowledge assistant for general readers.
The user sends ONE paragraph of text (which may be in a foreign language).
Identify the domain-specific terms, jargon, allusions, idioms, or named entities in it that a layperson may not understand.
For each one, explain it in {{to}}: 2-3 sentences, plain language, beginner-friendly background included.
Output format: one item per line, exactly as "术语：解释" (term, then a colon, then the explanation). Keep the original term before the colon.
If the paragraph contains nothing that needs explaining, write "本段无需解释的术语。" followed by a 2-sentence plain summary of the paragraph in {{to}}.
Output ONLY the explanation lines, no preamble, no markdown headers.`;

/** 解释缓存 key：service 维度 + 段落文本哈希（不同服务的解释不互通） */
export function explainCacheKey(serviceId: string, text: string): string {
  return `explain:${serviceId}:${fnv1a(normalizeText(text))}`;
}

export interface ExplainResult {
  content: string;
  generatedAt: number; // 生成/缓存时间戳
  cached: boolean;
}

export interface ExplainDeps {
  loadConfig: () => Promise<UserConfig>;
  area: CacheArea; // storage.local 封装
}

function fill(template: string, params: Record<string, string>): string {
  return template.replaceAll(/\{\{(\w+)\}\}/g, (_, k: string) => params[k] ?? '');
}

/** 段落术语解释：先查缓存（未过期直接返回），否则调 AI 并写缓存 */
export async function explainParagraph(deps: ExplainDeps, text: string): Promise<ExplainResult> {
  const config = await deps.loadConfig();
  const serviceId = config.explain.service === 'inherit' ? config.general.service : config.explain.service;
  // 机翻通道无解释能力（忽略提示词，只会把段落再翻译一遍）：诚实报错引导配置
  const svc = listServices(config).find((s) => s.id === serviceId);
  if (svc && svc.kind !== 'ai') {
    throw new Error('AI 搜索需要 AI 翻译服务（机翻通道无法解释术语）。请在「设置 → AI 搜索」指定 AI 服务');
  }
  const adapter = getAdapter(config, serviceId);
  const key = explainCacheKey(serviceId, text);
  const cacheMs = config.explain.cacheDays * 24 * 60 * 60 * 1000;

  // 1. 缓存命中（未过期）
  if (cacheMs > 0) {
    try {
      const stored = await deps.area.get([key]);
      const raw = stored[key];
      if (raw) {
        const rec = JSON.parse(raw) as { c?: string; t?: number };
        if (rec?.c && rec.t && Date.now() - rec.t < cacheMs) {
          return { content: rec.c, generatedAt: rec.t, cached: true };
        }
      }
    } catch {
      // 缓存损坏视为未命中
    }
  }

  // 2. 调 AI（systemOverride 整体替换翻译指令为解释指令）
  const out = await adapter.translate([text], 'auto', config.general.targetLanguage, {
    systemOverride: fill(EXPLAIN_SYSTEM_PROMPT, { to: config.general.targetLanguage }),
  });
  const content = out[0]?.trim() ?? '';
  if (!content) throw new Error('AI 未返回解释内容');

  // 3. 写缓存
  if (cacheMs > 0) {
    const now = Date.now();
    await deps.area.set({ [key]: JSON.stringify({ c: content, t: now }) }).catch(() => undefined);
    return { content, generatedAt: now, cached: false };
  }
  return { content, generatedAt: Date.now(), cached: false };
}

/** 组装导出文本：扫描全部解释缓存（storage 前缀 explain:） */
export async function buildExplainExport(area: CacheArea): Promise<{ text: string; count: number }> {
  const all = await area.get(null);
  const lines: string[] = [];
  let count = 0;
  const entries: Array<{ key: string; c: string; t: number }> = [];
  for (const [key, raw] of Object.entries(all)) {
    if (!key.includes('explain:')) continue;
    try {
      const rec = JSON.parse(String(raw)) as { c?: string; t?: number };
      if (rec?.c) entries.push({ key, c: rec.c, t: rec.t ?? 0 });
    } catch {
      // 跳过损坏项
    }
  }
  entries.sort((a, b) => a.t - b.t); // 按生成时间升序
  lines.push(`# 术语解释存档`);
  lines.push(`# 导出时间：${new Date().toLocaleString('zh-CN')}`);
  lines.push(`# 共 ${entries.length} 条（AI 搜索段落术语解释，供复盘学习）`);
  lines.push('');
  for (const e of entries) {
    count++;
    lines.push(`## [${new Date(e.t).toLocaleString('zh-CN')}]`);
    lines.push(e.c);
    lines.push('');
    lines.push('--------------------------------');
    lines.push('');
  }
  return { text: lines.join('\n'), count };
}

/** 清除全部解释缓存 */
export async function clearExplainCache(area: CacheArea): Promise<number> {
  const all = await area.get(null);
  const keys = Object.keys(all).filter((k) => k.includes('explain:'));
  if (keys.length > 0 && area.remove) {
    await area.remove(keys);
  }
  return keys.length;
}
