import { describe, expect, it } from 'vitest';
import { TranslateCache, type CacheArea } from './cache';
import { fnv1a, isTranslatable, normalizeText } from '@/core/shared/utils';

function memArea(): CacheArea & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    get: async (keys) => {
      const out: Record<string, string> = {};
      const ks = keys ?? [...data.keys()];
      for (const k of ks) {
        const v = data.get(k);
        if (v !== undefined) out[k] = v;
      }
      return out;
    },
    set: async (entries) => {
      for (const [k, v] of Object.entries(entries)) data.set(k, v);
    },
  };
}

describe('TranslateCache', () => {
  it('put 后 query 命中；未写入段缺失', async () => {
    const cache = new TranslateCache(memArea());
    await cache.put({ 'bing:en>zh-CN:1111': '你好' });
    const hits = await cache.query(['bing:en>zh-CN:1111', 'bing:en>zh-CN:2222']);
    expect(hits['bing:en>zh-CN:1111']).toBe('你好');
    expect('bing:en>zh-CN:2222' in hits).toBe(false);
  });

  it('key 对同一规范化文本稳定，空白差异不影响命中', async () => {
    const k1 = TranslateCache.key('bing', 'auto', 'zh-CN', 'hello  \n world');
    const k2 = TranslateCache.key('bing', 'auto', 'zh-CN', 'hello world');
    expect(k1).toBe(k2);
  });

  it('持久层写入带命名空间前缀', async () => {
    const area = memArea();
    const cache = new TranslateCache(area, 'cache');
    await cache.put({ k: 'v' });
    expect(area.data.has('cache:k')).toBe(true);
  });
});

describe('utils', () => {
  it('fnv1a 稳定且区分文本', () => {
    expect(fnv1a('hello')).toBe(fnv1a('hello'));
    expect(fnv1a('hello')).not.toBe(fnv1a('world'));
  });

  it('normalizeText 折叠空白', () => {
    expect(normalizeText('  a \n  b ')).toBe('a b');
  });

  it('isTranslatable 过滤纯符号与超短文本', () => {
    expect(isTranslatable('hello')).toBe(true);
    expect(isTranslatable('h', 2)).toBe(false);
    expect(isTranslatable('!!!')).toBe(false);
    expect(isTranslatable('123')).toBe(true); // 数字组合仍可译
  });
});
