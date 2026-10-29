import type { UserConfig } from '@/core/config/defaults';
import type { AdapterOptions, ServiceAdapter } from '../types';
import { ServiceError } from '../types';
import { withTimeout } from '../queue';

/**
 * 谷歌翻译免费接口（对齐原版 google-free）
 * - GET translate_a/single（client=gtx 公开通道；单段请求，批量由外层队列并发调度）
 * - from=auto 时使用返回的检测语言回填
 */

const ENDPOINT = 'https://translate.googleapis.com/translate_a/single';

/** 免费通道默认超时（不可达网络下提前失败，降级链更快切备选） */
const FETCH_TIMEOUT_MS = 8000;

interface GoogleResponse {
  0?: Array<Array<[string, string]>>;
  2?: string; // 检测语言
}

async function translateOne(
  text: string,
  from: string,
  to: string,
  opts?: AdapterOptions,
): Promise<string> {
  const params = new URLSearchParams({
    client: 'gtx',
    sl: from === 'auto' ? 'auto' : from,
    tl: to,
    dt: 't',
    q: text,
  });
  const res = await fetch(`${ENDPOINT}?${params.toString()}`, {
    signal: withTimeout(opts?.signal, FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new ServiceError(`translate failed: HTTP ${res.status}`, 'http');
  }
  const data = (await res.json()) as GoogleResponse;
  const segments = data?.[0];
  if (!Array.isArray(segments)) {
    throw new ServiceError('unexpected response shape', 'parse');
  }
  const translated = segments
    .map((seg) => seg?.[0] ?? '')
    .join('')
    .trim();
  if (!translated && text.trim()) {
    throw new ServiceError('empty translation result', 'parse');
  }
  return translated;
}

export function googleAdapter(_config: UserConfig): ServiceAdapter {
  return {
    id: 'google',
    batchLimit: 10,
    maxRps: 5,
    async translate(texts, from, to, opts) {
      // 单段接口：并发受外层 RateLimiter 控制，此处直接并发执行
      const out = await Promise.all(texts.map((t) => translateOne(t, from, to, opts)));
      return out;
    },
  };
}
