import { describe, expect, it } from 'vitest';
import { chunkTexts, RateLimiter } from './queue';

describe('RateLimiter', () => {
  it('窗口内请求数不超过 maxRps，超出排队等待', async () => {
    const limiter = new RateLimiter(3, undefined, 80); // 80ms 窗口便于测试
    const stamps: number[] = [];
    const t0 = Date.now();
    await Promise.all(
      Array.from({ length: 5 }, async () => {
        await limiter.acquire();
        stamps.push(Date.now() - t0);
      }),
    );
    expect(stamps.length).toBe(5);
    // 前 3 个立即获得（0ms 左右），第 4/5 个必须等待窗口滚动
    const immediate = stamps.filter((s) => s < 60).length;
    expect(immediate).toBeLessThanOrEqual(3);
  }, 5000);

  it('maxRps 至少为 1', () => {
    expect(new RateLimiter(0).maxRps).toBe(1);
  });
});

describe('chunkTexts', () => {
  it('按上限切块，尾块为余数', () => {
    const chunks = chunkTexts(['a', 'b', 'c', 'd', 'e'], 2);
    expect(chunks).toEqual([['a', 'b'], ['c', 'd'], ['e']]);
  });

  it('limit<=1 时不切', () => {
    expect(chunkTexts(['a', 'b'], 1)).toEqual([['a'], ['b']]);
  });
});
