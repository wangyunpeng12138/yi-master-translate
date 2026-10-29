import type { ServiceAdapter } from '../types';
import { ServiceError } from '../types';

/**
 * 微软翻译免费通道（对齐原版 bing-free 实测协议，2026-10-29 逆向修正）
 * - 端点：POST https://edge.microsoft.com/translate/translatetext?from=&to=&isEnterpriseClient=false
 * - 无需 Authorization/token（此前 translateauth 路线为错误实现，已删除）
 * - body：JSON 字符串数组 ["text1","text2",...]
 * - 响应：[{ detectedLanguage?, translations: [{ text, to }] }]（与请求等长）
 * - 语言映射：zh-CN→zh-Hans、zh-TW/zh-HK→zh-Hant 等（原版 langMap 全表）
 */

const ENDPOINT = 'https://edge.microsoft.com/translate/translatetext';

/** 原版 langMap（zh-CN → Edge 翻译语言码）全表 */
const LANG_MAP = new Map<string, string>([
  ['auto', ''],
  ['yue', 'yue'], ['ar', 'ar'], ['ga', 'ga'], ['et', 'et'], ['bg', 'bg'],
  ['is', 'is'], ['pl', 'pl'], ['bs', 'bs-Latn'], ['fa', 'fa'], ['da', 'da'],
  ['de', 'de'], ['ru', 'ru'], ['fr', 'fr'], ['zh-HK', 'zh-Hant'], ['zh-TW', 'zh-Hant'],
  ['fil', 'fil'], ['fj', 'fj'], ['fi', 'fi'], ['gu', 'gu'], ['kk', 'kk'],
  ['he', 'he'], ['ht', 'ht'], ['ko', 'ko'], ['ku', 'kmr'], ['ckb', 'ku'],
  ['nl', 'nl'], ['ca', 'ca'], ['zh-CN', 'zh-Hans'], ['wyw', 'lzh'], ['cs', 'cs'],
  ['kn', 'kn'], ['otq', 'otq'], ['tlh', 'tlh'], ['hr', 'hr'], ['lv', 'lv'],
  ['lt', 'lt'], ['ro', 'ro'], ['mg', 'mg'], ['mt', 'mt'], ['mr', 'mr'],
  ['ml', 'ml'], ['ms', 'ms'], ['mi', 'mi'], ['my', 'my'], ['bn', 'bn-BD'],
  ['hmn', 'mww'], ['af', 'af'], ['pa', 'pa'], ['pt-br', 'pt'], ['pt', 'pt-PT'],
  ['ps', 'ps'], ['ja', 'ja'], ['sv', 'sv'], ['sm', 'sm'], ['sr-Latn', 'sr-Latn'],
  ['sr-Cyrl', 'sr-Cyrl'], ['no', 'nb'], ['sk', 'sk'], ['sl', 'sl'], ['sw', 'sw'],
  ['ty', 'ty'], ['te', 'te'], ['ta', 'ta'], ['th', 'th'], ['to', 'to'],
  ['tr', 'tr'], ['cy', 'cy'], ['ur', 'ur'], ['uk', 'uk'], ['es', 'es'],
  ['el', 'el'], ['hu', 'hu'], ['it', 'it'], ['hi', 'hi'], ['id', 'id'],
  ['en', 'en'], ['yua', 'yua'], ['bo', 'bo'], ['vi', 'vi'], ['km', 'km'],
  ['ug', 'ug'],
]);

interface BingResponseItem {
  detectedLanguage?: { language?: string };
  translations?: Array<{ text?: string; to?: string }>;
}

export function bingAdapter(): ServiceAdapter {
  return {
    id: 'bing',
    batchLimit: 50, // 原版支持批量数组；单段上限 1800 字符（原版 maxTextLength）
    maxRps: 5,
    async translate(texts, from, to, opts) {
      const url = new URL(ENDPOINT);
      const mappedFrom = from === 'auto' ? '' : (LANG_MAP.get(from) ?? from);
      if (mappedFrom) url.searchParams.set('from', mappedFrom);
      url.searchParams.set('to', LANG_MAP.get(to) ?? to);
      url.searchParams.set('isEnterpriseClient', 'false');

      const res = await fetch(url.toString(), {
        method: 'POST',
        headers: {
          accept: '*/*',
          'content-type': 'application/json',
        },
        body: JSON.stringify(texts),
        credentials: 'omit',
        signal: opts?.signal,
      });
      if (!res.ok) {
        throw new ServiceError(`bing HTTP ${res.status}: ${(await res.text()).slice(0, 120)}`, 'http');
      }
      const data = (await res.json()) as BingResponseItem[];
      if (!Array.isArray(data) || data.length !== texts.length) {
        throw new ServiceError(
          `bingInvalidResponse: returned ${Array.isArray(data) ? data.length : 0} results for ${texts.length} texts`,
          'parse',
        );
      }
      return data.map((item) => item.translations?.[0]?.text ?? '');
    },
  };
}
