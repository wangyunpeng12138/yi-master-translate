import type { AdapterOptions, ServiceAdapter } from '../types';
import { ServiceError } from '../types';

/**
 * 微软翻译免费接口（对齐原版 bing-free：Edge 浏览器翻译通道）
 * - Token：GET https://edge.microsoft.com/translateauth（JWT，约 10 分钟有效）
 * - 翻译：POST api-edge.cognitive.microsofttranslator.com/translate（单批 ≤50 段）
 */

const AUTH_URL = 'https://edge.microsoft.com/translateauth';
const TRANSLATE_URL = 'https://api-edge.cognitive.microsofttranslator.com/translate';
const TOKEN_TTL_MS = 9 * 60 * 1000; // 保守 9 分钟

let cachedToken: { value: string; at: number } | null = null;

async function fetchToken(): Promise<string> {
  if (cachedToken && Date.now() - cachedToken.at < TOKEN_TTL_MS) {
    return cachedToken.value;
  }
  const res = await fetch(AUTH_URL);
  if (!res.ok) {
    throw new ServiceError(`auth failed: HTTP ${res.status}`, 'http');
  }
  const token = (await res.text()).trim();
  if (!token) throw new ServiceError('empty auth token', 'parse');
  cachedToken = { value: token, at: Date.now() };
  return token;
}

async function translateOnce(
  texts: string[],
  from: string,
  to: string,
  token: string,
  opts?: AdapterOptions,
): Promise<string[]> {
  const params = new URLSearchParams({
    from: from === 'auto' ? '' : from,
    to,
    'api-version': '3.0',
  });
  const res = await fetch(`${TRANSLATE_URL}?${params.toString()}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(texts.map((t) => ({ Text: t }))),
    signal: opts?.signal,
  });
  if (res.status === 401) {
    throw new ServiceError('token expired', 'http');
  }
  if (!res.ok) {
    throw new ServiceError(`translate failed: HTTP ${res.status}`, 'http');
  }
  const data = (await res.json()) as Array<{ translations?: Array<{ text?: string }> }>;
  const out = data.map((item) => item.translations?.[0]?.text ?? '');
  if (out.length !== texts.length) {
    throw new ServiceError('response length mismatch', 'parse');
  }
  return out;
}

export function bingAdapter(): ServiceAdapter {
  return {
    id: 'bing',
    batchLimit: 50,
    maxRps: 5,
    async translate(texts, from, to, opts) {
      try {
        return await translateOnce(texts, from, to, await fetchToken(), opts);
      } catch (e) {
        // token 过期重试一次
        if (e instanceof ServiceError && e.code === 'http' && cachedToken) {
          cachedToken = null;
          return translateOnce(texts, from, to, await fetchToken(), opts);
        }
        throw e;
      }
    },
  };
}
