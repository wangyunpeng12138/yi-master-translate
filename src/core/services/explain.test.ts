import { describe, expect, it, vi } from 'vitest';
import { explainCacheKey, explainParagraph, buildExplainExport, clearExplainCache } from './explain';
import type { UserConfig } from '@/core/config/defaults';
import { DEFAULT_CONFIG } from '@/core/config/defaults';

// registry 打桩：getAdapter 同步返回适配器；listServices 标记为 AI 服务（跳过机翻防御）
vi.mock('./registry', () => ({
  getAdapter: () => ({
    id: 'mock-ai',
    batchLimit: 1,
    maxRps: 5,
    async translate() {
      return ['术语A：解释内容'];
    },
  }),
  listServices: () => [{ id: 'bing', name: 'Bing', kind: 'ai', needsSetup: false }],
}));

function makeConfig(patch: Partial<UserConfig['explain']> = {}): UserConfig {
  const c = structuredClone(DEFAULT_CONFIG);
  c.explain = { ...c.explain, ...patch };
  return c;
}

function makeArea(data: Record<string, string> = {}) {
  const store = new Map(Object.entries(data));
  const removed: string[] = [];
  return {
    area: {
      get: async (keys?: string[] | null) => {
        if (keys == null) return Object.fromEntries(store.entries());
        const out: Record<string, string> = {};
        for (const k of keys) if (store.has(k)) out[k] = store.get(k)!;
        return out;
      },
      set: async (entries: Record<string, string>) => {
        for (const [k, v] of Object.entries(entries)) store.set(k, v);
      },
      remove: async (keys: string[]) => {
        for (const k of keys) {
          store.delete(k);
          removed.push(k);
        }
      },
    },
    removed,
  };
}

describe('explainCacheKey', () => {
  it('服务与文本维度生成稳定 key', () => {
    expect(explainCacheKey('openai-custom', 'Hello term')).toBe(explainCacheKey('openai-custom', 'Hello term'));
    expect(explainCacheKey('a', 't')).not.toBe(explainCacheKey('b', 't'));
  });
});

describe('explainParagraph', () => {
  it('缓存命中且未过期 → 直接返回且不写缓存', async () => {
    const key = explainCacheKey('bing', 'some paragraph');
    const { area } = makeArea({ [key]: JSON.stringify({ c: '缓存解释', t: Date.now() }) });
    const deps = { loadConfig: async () => makeConfig({ service: 'bing', cacheDays: 30 }), area };
    const r = await explainParagraph(deps, 'some paragraph');
    expect(r.cached).toBe(true);
    expect(r.content).toBe('缓存解释');
  });

  it('缓存过期 → 调 AI 并重写缓存', async () => {
    const key = explainCacheKey('bing', 'old paragraph');
    const stale = JSON.stringify({ c: '旧解释', t: Date.now() - 40 * 24 * 60 * 60 * 1000 });
    const { area } = makeArea({ [key]: stale });
    const deps = { loadConfig: async () => makeConfig({ service: 'bing', cacheDays: 30 }), area };
    const r = await explainParagraph(deps, 'old paragraph');
    expect(r.cached).toBe(false);
    expect(r.content).toContain('术语A');
    // 新缓存已写入
    const stored = await area.get([key]);
    expect(JSON.parse(stored[key]).c).toContain('术语A');
  });

  it('cacheDays=0 → 不读不写缓存', async () => {
    const { area } = makeArea();
    const deps = { loadConfig: async () => makeConfig({ service: 'bing', cacheDays: 0 }), area };
    await explainParagraph(deps, 'fresh paragraph');
    const all = await area.get(null);
    expect(Object.keys(all)).toHaveLength(0);
  });
});

describe('buildExplainExport / clearExplainCache', () => {
  it('导出只含 explain 条目并按时间排序；清空返回删除数', async () => {
    const k1 = 'imt:explain:a';
    const k2 = 'imt:explain:b';
    const now = Date.now();
    const { area } = makeArea({
      [k2]: JSON.stringify({ c: '第二条', t: now + 1000 }),
      [k1]: JSON.stringify({ c: '第一条', t: now }),
      'imt:cache:trans': '普通翻译缓存不应被导出',
    });
    const exp = await buildExplainExport(area);
    expect(exp.count).toBe(2);
    expect(exp.text.indexOf('第一条')).toBeLessThan(exp.text.indexOf('第二条'));
    expect(exp.text).not.toContain('普通翻译缓存');

    const removed = await clearExplainCache(area);
    expect(removed).toBe(2);
    const rest = await area.get(null);
    expect(Object.keys(rest)).toHaveLength(1); // 翻译缓存保留
  });
});
