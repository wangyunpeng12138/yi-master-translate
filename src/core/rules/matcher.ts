import type { SiteRule } from './types';
import { X_RULE } from './sites/x';

/** 内置站点规则（按匹配优先级排在前面的先命中） */
export const BUILTIN_RULES: SiteRule[] = [X_RULE];

function globToRegExp(pattern: string): RegExp {
  // 只处理 * 通配；转义其余正则元字符
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`, 'i');
}

function matchesPattern(url: URL, pattern: string): boolean {
  const target = `${url.hostname}${url.pathname}`;
  const hostAndPath = `${url.hostname}${url.pathname}${url.search}`;
  if (!pattern.includes('/')) {
    // 纯 host 模式：精确或子域匹配
    const host = url.hostname.toLowerCase();
    const p = pattern.toLowerCase();
    return host === p || host.endsWith(`.${p}`);
  }
  return globToRegExp(pattern).test(target) || globToRegExp(pattern).test(hostAndPath);
}

/** 按 URL 匹配站点规则；未命中返回 null（走通用启发式） */
export function matchSiteRule(href: string, rules: SiteRule[] = BUILTIN_RULES): SiteRule | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  for (const rule of rules) {
    const hit = rule.matches.some((p) => matchesPattern(url, p));
    if (!hit) continue;
    const excluded = (rule.excludeMatches ?? []).some((p) => matchesPattern(url, p));
    if (excluded) continue;
    return rule;
  }
  return null;
}
