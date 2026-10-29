import type { UserConfig } from '@/core/config/defaults';
import type { TranslateRequest } from '@/core/shared/types';
import { isTranslatable, normalizeText } from '@/core/shared/utils';
import { TranslateCache } from './cache';
import { getAdapter } from './registry';
import { chunk, RateLimiter, withRateLimit } from './queue';

/**
 * 翻译批处理调度（background 内核入口）
 * 流程：过滤不可译段 → 缓存命中 → 分块 → 限流请求 → 合并结果 → 回写缓存
 */

export interface BatchDeps {
  cache: TranslateCache;
  loadConfig: () => Promise<UserConfig>;
}

/** 从配置展开生效术语与专家提示词 */
export function buildAdapterOptions(config: UserConfig, scope: string) {
  const terms = config.terms.libraries
    .filter((lib) => lib.enabled)
    .flatMap((lib) =>
      lib.terms.map((t) => ({
        from: t.from,
        to: t.to,
        caseSensitive: t.caseSensitive ?? false,
      })),
    );
  const expert = config.ai.experts.find((e) => e.id === config.ai.activeExpertId);
  return {
    terms,
    expertPrompt: config.ai.enabled && expert?.prompt ? expert.prompt : undefined,
    scope,
  };
}

export async function translateBatch(
  deps: BatchDeps,
  req: TranslateRequest,
): Promise<string[]> {
  const config = await deps.loadConfig();
  const adapter = withRateLimit(getAdapter(config, req.service), new RateLimiter(5));
  const opts = buildAdapterOptions(config, req.scope);

  // 1. 过滤 + 规范化
  const normalized = req.texts.map((t) => normalizeText(t));
  const indexes: number[] = [];
  const missTexts: string[] = [];
  const results: string[] = new Array(req.texts.length).fill('');

  normalized.forEach((text, i) => {
    if (!isTranslatable(text, config.engine.minParagraphChars)) {
      results[i] = req.texts[i] ?? ''; // 不可译段原样返回
    } else {
      indexes.push(i);
      missTexts.push(text);
    }
  });

  // 2. 缓存命中
  const keys = missTexts.map((t) => TranslateCache.key(req.service, req.from, req.to, t));
  const hits = await deps.cache.query(keys);
  const pending: Array<{ idx: number; text: string; key: string }> = [];
  keys.forEach((key, k) => {
    if (key in hits) {
      results[indexes[k]] = hits[key];
    } else {
      pending.push({ idx: indexes[k], text: missTexts[k], key });
    }
  });

  // 3. 分块请求（缓存未命中部分）
  const newEntries: Record<string, string> = {};
  for (const batch of chunk(pending, adapter.batchLimit)) {
    const batchTexts = batch.map((p) => p.text);
    const out = await adapter.translate(batchTexts, req.from, req.to, opts);
    out.forEach((translated, j) => {
      const item = batch[j];
      results[item.idx] = translated;
      newEntries[item.key] = translated;
    });
  }

  // 4. 回写缓存
  if (Object.keys(newEntries).length > 0) {
    await deps.cache.put(newEntries);
  }
  return results;
}
