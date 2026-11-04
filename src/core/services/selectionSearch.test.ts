import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SELECTION_SEARCH_SYSTEM_PROMPT,
  resolveSelectionSearchService,
  searchSelection,
  selectionSearchCacheKey,
} from './selectionSearch';
import type { UserConfig } from '@/core/config/defaults';
import { DEFAULT_CONFIG } from '@/core/config/defaults';

/** 适配器/服务表打桩：translate 记录调用参数并返回固定解释 */
const translateSpy = vi.fn(async () => ['测试词：这是中文解释内容。']);
vi.mock('./registry', () => ({
  getAdapter: () => ({
    id: 'mock-ai',
    batchLimit: 1,
    maxRps: 5,
    translate: translateSpy,
  }),
  listServices: () => [
    { id: 'mock-ai', name: 'Mock AI', kind: 'ai', needsSetup: false },
    { id: 'bing', name: 'Bing', kind: 'machine', needsSetup: false },
  ],
}));

function makeConfig(patch: {
  selection?: Partial<UserConfig['selection']>;
  explain?: Partial<UserConfig['explain']>;
  general?: Partial<UserConfig['general']>;
} = {}): UserConfig {
  const c = structuredClone(DEFAULT_CONFIG);
  c.selection = { ...c.selection, ...(patch.selection ?? {}) };
  c.explain = { ...c.explain, ...(patch.explain ?? {}) };
  c.general = { ...c.general, ...(patch.general ?? {}) };
  return c;
}

function makeArea(data: Record<string, string> = {}) {
  const store = new Map(Object.entries(data));
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
        for (const k of keys) store.delete(k);
      },
    },
  };
}

beforeEach(() => {
  translateSpy.mockClear();
});

describe('resolveSelectionSearchService（默认同步用户选择的 AI 服务）', () => {
  it('显式指定服务时直接使用', () => {
    expect(resolveSelectionSearchService(makeConfig({ selection: { aiSearchService: 'mock-ai' } }))).toBe('mock-ai');
  });

  it('inherit → 跟随「AI 搜索」页服务', () => {
    const c = makeConfig({ selection: { aiSearchService: 'inherit' }, explain: { service: 'mock-ai' } });
    expect(resolveSelectionSearchService(c)).toBe('mock-ai');
  });

  it('双层 inherit → 跟随全局翻译服务', () => {
    const c = makeConfig({
      selection: { aiSearchService: 'inherit' },
      explain: { service: 'inherit' },
      general: { service: 'mock-ai' },
    });
    expect(resolveSelectionSearchService(c)).toBe('mock-ai');
  });
});

describe('searchSelection（划词 AI 搜索）', () => {
  it('调用 AI 时使用中文解释提示词（systemOverride）', async () => {
    const { area } = makeArea();
    const deps = { loadConfig: async () => makeConfig({ selection: { aiSearchService: 'mock-ai' } }), area };
    const r = await searchSelection(deps, '  transformer  ');
    expect(r.content).toContain('中文解释');
    const args = translateSpy.mock.calls[0] as unknown[];
    expect(args[0]).toEqual(['transformer']); // 文本已 normalize
    expect(args[2]).toBe('简体中文'); // 固定中文输出
    const opts = args[3] as { systemOverride: string };
    expect(opts.systemOverride).toContain('Explain it in 简体中文');
    expect(opts.systemOverride).not.toContain('{{'); // 占位符已填充
    expect(SELECTION_SEARCH_SYSTEM_PROMPT).toContain('{{to}}');
  });

  it('写入缓存且二次命中缓存不重复调 AI', async () => {
    const { area } = makeArea();
    const config = makeConfig({ selection: { aiSearchService: 'mock-ai' }, explain: { cacheDays: 30 } });
    const deps = { loadConfig: async () => config, area };
    const first = await searchSelection(deps, 'deep learning');
    expect(first.cached).toBe(false);
    const key = selectionSearchCacheKey('mock-ai', 'deep learning');
    const stored = await area.get([key]);
    expect(JSON.parse(stored[key]).c).toContain('中文解释');

    translateSpy.mockClear();
    const second = await searchSelection(deps, 'deep learning');
    expect(second.cached).toBe(true);
    expect(translateSpy).not.toHaveBeenCalled();
  });

  it('机翻服务 → 抛错引导配置 AI 服务', async () => {
    const { area } = makeArea();
    const deps = { loadConfig: async () => makeConfig({ selection: { aiSearchService: 'bing' } }), area };
    await expect(searchSelection(deps, 'hello')).rejects.toThrow('需要 AI 翻译服务');
  });

  it('空文本 → 抛错', async () => {
    const { area } = makeArea();
    const deps = { loadConfig: async () => makeConfig({ selection: { aiSearchService: 'mock-ai' } }), area };
    await expect(searchSelection(deps, '   ')).rejects.toThrow('未选中可解释的文字');
  });
});