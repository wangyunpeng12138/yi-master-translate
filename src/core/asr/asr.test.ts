import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '@/core/config/defaults';
import type { UserConfig } from '@/core/config/defaults';
import { getAsrChain, hasUsableAsrProvider, isAsrProviderImplemented, listAsrProviders } from './registry';
import { audioFingerprint, asrCacheKey, clearAsrCache, getAsrCache, setAsrCache } from './cache';
import { arrayBufferToBase64, base64ToArrayBuffer } from './audio/codec';

function cfg(patch: Partial<UserConfig['asr']> = {}): UserConfig {
  return { ...DEFAULT_CONFIG, asr: { ...DEFAULT_CONFIG.asr, enabled: true, ...patch } };
}

describe('ASR provider 链', () => {
  it('未启用时链为空（不采集、不请求）', () => {
    expect(getAsrChain(cfg({ enabled: false }))).toEqual([]);
    expect(hasUsableAsrProvider(cfg({ enabled: false }))).toBe(false);
  });

  it('provider=off 等同关闭', () => {
    expect(getAsrChain(cfg({ provider: 'off' }))).toEqual([]);
  });

  it('auto 时按「cloud.provider → fallbackOrder」去重排序，未实现项被过滤', () => {
    const chain = getAsrChain(
      cfg({ provider: 'auto', cloud: { ...DEFAULT_CONFIG.asr.cloud, provider: 'deepgram', fallbackOrder: ['local-whisper', 'groq-whisper', 'deepgram'] } }),
    );
    expect(chain).toEqual(['deepgram', 'groq-whisper']); // local-whisper 在 A1 未实现
  });

  it('指定 provider 时其自身排在最前', () => {
    const chain = getAsrChain(
      cfg({ provider: 'groq-whisper', cloud: { ...DEFAULT_CONFIG.asr.cloud, fallbackOrder: ['openai-whisper'] } }),
    );
    expect(chain[0]).toBe('groq-whisper');
    expect(chain).toContain('openai-whisper');
  });

  it('本地 Whisper 当前标记为未实现', () => {
    expect(isAsrProviderImplemented('local-whisper')).toBe(false);
    expect(isAsrProviderImplemented('openai-whisper')).toBe(true);
  });

  it('能力表包含 5 个已实现 provider + 1 个待接入', () => {
    const list = listAsrProviders(DEFAULT_CONFIG);
    expect(list.filter((p) => p.implemented).length).toBe(5);
    expect(list.some((p) => p.id === 'local-whisper' && !p.implemented)).toBe(true);
    const openai = list.find((p) => p.id === 'openai-whisper');
    expect(openai?.needsKey).toBe(true);
    expect(openai?.resolvedEndpoint).toBe('https://api.openai.com');
  });
});

describe('ASR 缓存', () => {
  function memoryArea() {
    const store: Record<string, unknown> = {};
    return {
      store,
      get: async (keys: string[] | null) =>
        keys === null ? { ...store } : Object.fromEntries(keys.filter((k) => k in store).map((k) => [k, store[k]])),
      set: async (entries: Record<string, unknown>) => {
        Object.assign(store, entries);
      },
      remove: async (keys: string[]) => {
        keys.forEach((k) => delete store[k]);
      },
    };
  }

  it('音频指纹相同则键相同，长度不同则不同', () => {
    const a = new Uint8Array(1000).fill(7).buffer;
    const b = new Uint8Array(1000).fill(7).buffer;
    const c = new Uint8Array(1001).fill(7).buffer;
    expect(audioFingerprint(a)).toBe(audioFingerprint(b));
    expect(audioFingerprint(a)).not.toBe(audioFingerprint(c));
    expect(asrCacheKey('openai-whisper', 'auto', audioFingerprint(a))).toContain('asr:openai-whisper:auto:');
  });

  it('写入后可命中，过期后返回 null 并清理', async () => {
    const area = memoryArea();
    const key = asrCacheKey('x', 'en', 'fp');
    await setAsrCache(area, key, { cues: [{ start: 0, end: 1, text: 'hi' }], createdAt: Date.now(), provider: 'x', lang: 'en' });
    expect((await getAsrCache(area, key, 30))?.cues[0].text).toBe('hi');

    await area.set({ [key]: { cues: [], createdAt: Date.now() - 40 * 86_400_000, provider: 'x', lang: 'en' } });
    expect(await getAsrCache(area, key, 30)).toBeNull();
    expect(Object.keys(area.store)).toHaveLength(0); // 过期即删
  });

  it('clearAsrCache 只清 asr: 前缀', async () => {
    const area = memoryArea();
    await area.set({ 'asr:a': 1, 'asr:b': 2, 'translate:x': 3 });
    expect(await clearAsrCache(area)).toBe(2);
    expect(Object.keys(area.store)).toEqual(['translate:x']);
  });
});

describe('base64 往返', () => {
  it('大缓冲不失真', () => {
    const src = new Uint8Array(70_000);
    for (let i = 0; i < src.length; i++) src[i] = i % 256;
    const back = new Uint8Array(base64ToArrayBuffer(arrayBufferToBase64(src.buffer)));
    expect(back.length).toBe(src.length);
    expect(back[0]).toBe(0);
    expect(back[69_999]).toBe(69_999 % 256);
  });
});
