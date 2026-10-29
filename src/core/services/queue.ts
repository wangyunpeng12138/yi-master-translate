import type { ServiceAdapter } from './types';

/**
 * 每秒最大请求数限流器（对齐原版「每秒最大请求数：超出进入排队」语义）
 * 独立纯逻辑，可单测（时钟注入）。
 */
export class RateLimiter {
  private slots: number[] = [];
  private readonly windowMs: number;

  constructor(
    public maxRps: number,
    private readonly clock: () => number = () => Date.now(),
    windowMs = 1000,
  ) {
    this.maxRps = Math.max(1, maxRps);
    this.windowMs = windowMs;
  }

  /** 占用一个请求槽；超限时等待到下一个空槽 */
  async acquire(): Promise<void> {
    for (;;) {
      const now = this.clock();
      this.slots = this.slots.filter((t) => now - t < this.windowMs);
      if (this.slots.length < this.maxRps) {
        this.slots.push(now);
        return;
      }
      const waitMs = this.slots[0] + this.windowMs - now;
      await new Promise((r) => setTimeout(r, Math.max(waitMs, 1)));
    }
  }
}

/**
 * 服务限流包装器：适配器调用前 acquire，实现请求排队。
 * 由于 acquire 仅节流每秒请求数，不做全局互斥，允许有限并发。
 */
export function withRateLimit(
  adapter: ServiceAdapter,
  limiter: RateLimiter,
): ServiceAdapter {
  return {
    ...adapter,
    translate: async (texts, from, to, opts) => {
      await limiter.acquire();
      return adapter.translate(texts, from, to, opts);
    },
  };
}

/** 把列表按 batchLimit 切块（泛型：支持段落对象等任意元素） */
export function chunk<T>(texts: T[], limit: number): T[][] {
  const out: T[][] = [];
  const size = Math.max(1, limit);
  for (let i = 0; i < texts.length; i += size) out.push(texts.slice(i, i + size));
  return out;
}

// 兼容旧导出名（段落切块）
export const chunkTexts = chunk;
