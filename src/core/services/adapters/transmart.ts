import type { ServiceAdapter } from '../types';
import { ServiceError } from '../types';
import { withTimeout } from '../queue';

/**
 * 腾讯 TranSmart 免费通道（对齐原版 transmart-free 实测协议，2026-10-29 逆向）
 * - 端点：GET https://wxapp.translator.qq.com/api/translate?source=&target=&sourceText=...
 * - 伪装微信小程序上下文（referrer 固定；UA 不校验，浏览器默认即可通过）
 * - 单段请求（原版 isSupportList=false）；响应 { targetText, source, target }
 * - 国内网络可直连（微软/谷歌域不可达环境下的可靠免费通道）
 */

const ENDPOINT = 'https://wxapp.translator.qq.com/api/translate';
const REFERRER = 'https://servicewechat.com/wxb1070eabc6f9107e/117/page-frame.html';
const GUID = 'oqdgX0SIwhvM0TmqzTHghWBvfk22'; // 原版内置固定 guid

/** 免费通道默认超时（不可达网络下提前失败，降级链更快切备选） */
const FETCH_TIMEOUT_MS = 8000;

/** 原版 langMap（zh-CN → TranSmart 语言码） */
const LANG_MAP = new Map<string, string>([
  ['auto', 'auto'],
  ['zh-CN', 'zh'],
  ['zh-TW', 'zh-TW'],
  ['de', 'de'], ['en', 'en'], ['es', 'es'], ['fr', 'fr'], ['id', 'id'],
  ['it', 'it'], ['ja', 'jp'], ['ko', 'kr'], ['ms', 'ms'], ['pt', 'pt'],
  ['ru', 'ru'], ['th', 'th'], ['tr', 'tr'], ['vi', 'vi'],
]);

interface TransmartResponse {
  errCode?: number;
  errMsg?: string;
  targetText?: string;
  source?: string;
  target?: string;
}

async function translateOne(text: string, from: string, to: string, signal?: AbortSignal): Promise<string> {
  const params = new URLSearchParams({
    source: LANG_MAP.get(from) ?? from,
    target: LANG_MAP.get(to) ?? to,
    sourceText: text,
    platform: 'WeChat_APP',
    candidateLangs: 'en|zh',
    guid: GUID,
  });
  const res = await fetch(`${ENDPOINT}?${params.toString()}`, {
    method: 'GET',
    headers: { 'content-type': 'application/json' },
    referrer: REFERRER,
    credentials: 'omit',
    signal: withTimeout(signal, FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new ServiceError(`transmart HTTP ${res.status}`, 'http');
  }
  const data = (await res.json()) as TransmartResponse;
  if (data.errCode !== 0 || data.errMsg) {
    throw new ServiceError(`transmart errCode ${data.errCode}: ${data.errMsg ?? ''}`, 'parse');
  }
  // 腾讯对目录编号/控制符类文本会返回空译文：原样返回原文，
  // 由 content 端「译文==原文」过滤决定不插 wrapper（视同无需翻译）
  if (!data.targetText) return text;
  return data.targetText;
}

export function transmartAdapter(): ServiceAdapter {
  return {
    id: 'transmart',
    batchLimit: 1, // 原版单段接口
    maxRps: 3,
    async translate(texts, from, to, opts) {
      // 单段接口逐段请求；并发由外层 RateLimiter 控速
      return Promise.all(texts.map((t) => translateOne(t, from, to, opts?.signal)));
    },
  };
}
