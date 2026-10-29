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
  const serviceId = req.service === 'inherit' ? config.general.service : req.service;
  const base = getAdapter(config, serviceId);
  // 限流取适配器自身 maxRps（transmart 限 3rps 遵守腾讯接口限制；原写死 5 会触发对方限流再绕道降级）
  const adapter = withRateLimit(base, new RateLimiter(base.maxRps));
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

  // 3. 分块请求（缓存未命中部分），免费机器通道失败时自动降级互备（评审 3.3-7）
  //    降级优先级：微软域不可达场景优先切腾讯 TranSmart（国内可直连）
  const FREE_FALLBACK: Record<string, string> = {
    bing: 'transmart',
    'bing-free': 'transmart',
    transmart: 'bing',
    'transmart-free': 'bing',
    google: 'transmart',
    'google-free': 'transmart',
  };
  const newEntries: Record<string, string> = {};
  for (const batch of chunk(pending, adapter.batchLimit)) {
    const batchTexts = batch.map((p) => p.text);
    let out: string[];
    try {
      out = await adapter.translate(batchTexts, req.from, req.to, opts);
    } catch (e) {
      const fallbackId = FREE_FALLBACK[serviceId];
      if (!fallbackId) throw e; // 自定义/AI 服务不降级
      console.warn(`[imt-rebuild] ${serviceId} 失败，降级到 ${fallbackId}：`, e);
      const fbAdapter = getAdapter(config, fallbackId);
      const fb = withRateLimit(fbAdapter, new RateLimiter(fbAdapter.maxRps));
      out = await fb.translate(batchTexts, req.from, req.to, opts);
    }
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
