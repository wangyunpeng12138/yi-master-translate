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

/**
 * 按服务共享限流器（模块级）：并发消息各自 new RateLimiter 会使实际 rps 翻倍
 * （首屏尾部块与滚动懒翻译首批并发时曾达 6rps，触发腾讯限流），必须全局每服务一个。
 */
const rateLimiters = new Map<string, RateLimiter>();
function getLimiter(serviceId: string, maxRps: number): RateLimiter {
  let limiter = rateLimiters.get(serviceId);
  if (!limiter || limiter.maxRps !== maxRps) {
    limiter = new RateLimiter(maxRps);
    rateLimiters.set(serviceId, limiter);
  }
  return limiter;
}

/** 统一包装为 Error：DOMException（fetch 超时/abort）不是 Error 实例，
 *  直接从 onMessage 监听器 Promise reject 会触发 Chrome 通用诊断
 *  「A runtime.onMessage listener's promise rejected without an Error」，顶掉真实错误信息 */
function toError(e: unknown): Error {
  if (e instanceof Error) return e;
  if (e instanceof DOMException) return new Error(`DOMException: ${e.name}: ${e.message}`);
  return new Error(String((e as { message?: string })?.message ?? e));
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
  // 限流取适配器自身 maxRps 且按服务共享（transmart 限 3rps 遵守腾讯接口限制）
  const adapter = withRateLimit(base, getLimiter(serviceId, base.maxRps));
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

  // 2. 缓存命中；同批相同文本只请求一次，结果展开回填所有位置（walker 不再做文本去重，
  //    重复段落每个元素都要 wrapper，但出网必须合并，避免重复段落重复计费/限流）
  const keys = missTexts.map((t) => TranslateCache.key(req.service, req.from, req.to, t));
  const hits = await deps.cache.query([...new Set(keys)]);
  const missMap = new Map<string, { text: string; idxs: number[] }>();
  keys.forEach((key, k) => {
    if (key in hits) {
      results[indexes[k]] = hits[key];
    } else {
      const entry = missMap.get(key);
      if (entry) entry.idxs.push(indexes[k]);
      else missMap.set(key, { text: missTexts[k], idxs: [indexes[k]] });
    }
  });
  const pending = [...missMap.entries()].map(([key, v]) => ({ key, text: v.text, idxs: v.idxs }));

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
      // 自定义/AI 服务不降级；统一包装 Error（DOMException 非 Error 实例，直接 reject 会
      // 触发 Chrome 通用诊断顶掉真实错误）
      if (!fallbackId) throw toError(e);
      console.warn(`[imt-rebuild] ${serviceId} 失败，降级到 ${fallbackId}：`, e);
      const fbAdapter = getAdapter(config, fallbackId);
      const fb = withRateLimit(fbAdapter, getLimiter(fallbackId, fbAdapter.maxRps));
      try {
        out = await fb.translate(batchTexts, req.from, req.to, opts);
      } catch {
        // 降级也失败：抛首次的原始错误（保留首选服务失败语义），且包装为 Error
        throw toError(e);
      }
    }
    out.forEach((translated, j) => {
      const item = batch[j];
      item.idxs.forEach((idx) => {
        results[idx] = translated;
      });
      newEntries[item.key] = translated;
    });
  }

  // 4. 回写缓存
  if (Object.keys(newEntries).length > 0) {
    await deps.cache.put(newEntries);
  }
  return results;
}
