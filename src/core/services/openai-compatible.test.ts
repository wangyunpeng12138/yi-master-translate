import { afterEach, describe, expect, it, vi } from 'vitest';
import { openaiCompatibleAdapter, isLocalUrl } from './adapters/openai-compatible';
import type { UserConfig } from '@/core/config/defaults';
import { DEFAULT_CONFIG } from '@/core/config/defaults';

/**
 * OpenAI 兼容适配器：本地服务空 Key 放宽（Ollama 开箱即用）
 * - 本地回环地址（localhost/127.0.0.1/[::1]）允许空 apiKey，请求头不带 Authorization
 * - 公网地址仍必须配置 key（no-key 错误）
 */

function makeConfig(
  services: Array<{ id: string; apiKey: string; apiUrl: string; model?: string }>,
): UserConfig {
  const c = structuredClone(DEFAULT_CONFIG);
  c.customServices = services.map((s) => ({
    id: s.id,
    name: s.id,
    apiKey: s.apiKey,
    apiUrl: s.apiUrl,
    model: s.model ?? 'test-model',
    temperature: 0,
    maxRps: 5,
  }));
  return c;
}

function okResponse(content = '你好') {
  return {
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content } }] }),
    text: async () => '',
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('isLocalUrl（本地回环地址识别）', () => {
  it('localhost / 127.0.0.1 / [::1] 识别为本地', () => {
    expect(isLocalUrl('http://127.0.0.1:11434/v1')).toBe(true);
    expect(isLocalUrl('http://localhost:11434/v1/chat/completions')).toBe(true);
    expect(isLocalUrl('http://[::1]:11434/v1')).toBe(true);
  });

  it('公网地址不识别为本地', () => {
    expect(isLocalUrl('https://api.openai.com/v1/chat/completions')).toBe(false);
    expect(isLocalUrl('https://api.deepseek.com/v1')).toBe(false);
  });

  it('非法字符串安全返回 false', () => {
    expect(isLocalUrl('')).toBe(false);
    expect(isLocalUrl('not a url')).toBe(false);
  });
});

describe('本地服务空 API Key（Ollama 开箱即用）', () => {
  it('本地地址空 key 正常翻译，且请求头不带 Authorization', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    vi.stubGlobal('fetch', fetchMock);
    const config = makeConfig([{ id: 'local-ollama', apiKey: '', apiUrl: 'http://127.0.0.1:11434/v1' }]);
    const adapter = openaiCompatibleAdapter(config, 'local-ollama');

    const out = await adapter.translate(['hello'], 'en', 'zh-CN');
    expect(out).toEqual(['你好']);

    const headers = (fetchMock.mock.calls[0] as unknown[])[1] as RequestInit & {
      headers: Record<string, string>;
    };
    expect(headers.headers.Authorization).toBeUndefined();
    // Base URL 自动补全（normalizeApiUrl）
    expect((fetchMock.mock.calls[0] as unknown[])[0]).toBe(
      'http://127.0.0.1:11434/v1/chat/completions',
    );
  });

  it('公网地址空 key 仍抛 no-key 配置错误', async () => {
    const config = makeConfig([{ id: 'no-key-svc', apiKey: '', apiUrl: 'https://api.example.com/v1' }]);
    const adapter = openaiCompatibleAdapter(config, 'no-key-svc');
    await expect(adapter.translate(['hello'], 'en', 'zh-CN')).rejects.toMatchObject({ code: 'no-key' });
  });

  it('本地地址填了 key 时照常携带 Authorization', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    vi.stubGlobal('fetch', fetchMock);
    const config = makeConfig([
      { id: 'local-with-key', apiKey: 'sk-local', apiUrl: 'http://localhost:9000/v1/chat/completions' },
    ]);
    const adapter = openaiCompatibleAdapter(config, 'local-with-key');

    await adapter.translate(['hello'], 'en', 'zh-CN');
    const headers = (fetchMock.mock.calls[0] as unknown[])[1] as RequestInit & {
      headers: Record<string, string>;
    };
    expect(headers.headers.Authorization).toBe('Bearer sk-local');
  });
});
