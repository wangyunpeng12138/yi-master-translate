import zhCN from './zh-CN';
import en from './en';

/**
 * 运行时 i18n（P1 简化版：zh-CN 完整 / en 部分，缺键回退 zh-CN，最终回退 key）
 */

type Dict = Record<string, unknown>;

const DICTS: Record<string, Dict> = {
  'zh-CN': zhCN as unknown as Dict,
  en: en as unknown as Dict,
};

let currentLang: string = 'zh-CN';

export function setI18nLang(lang: string): void {
  currentLang = DICTS[lang] ? lang : 'zh-CN';
}

export function getI18nLang(): string {
  return currentLang;
}

/** t('nav.general') → 文案；占位符 {{name}} 用 params 替换 */
export function t(key: string, params?: Record<string, string | number>): string {
  const lookup = (dict: Dict): string | undefined => {
    let node: unknown = dict;
    for (const part of key.split('.')) {
      if (typeof node !== 'object' || node === null) return undefined;
      node = (node as Dict)[part];
    }
    return typeof node === 'string' ? node : undefined;
  };
  let text = lookup(DICTS[currentLang]) ?? lookup(DICTS['zh-CN']) ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.replaceAll(`{{${k}}}`, String(v));
    }
  }
  return text;
}
