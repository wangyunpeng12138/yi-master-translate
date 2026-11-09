import { isSameTargetLang, isTranslatable, normalizeText } from '@/core/shared/utils';
import type { UserConfig } from '@/core/config/defaults';
import { matchSiteRule, type SiteRule } from '@/core/rules';

/**
 * 段落识别器（ParagraphWalker）
 * - 命中站点规则时：用规则的 selectors（显式段落），并应用 excludeSelectors
 * - 未命中时：通用启发式选择器（p/h1/li/td…）
 * - 跳过：代码/脚本/不可见/尺寸退化（SEO 隐藏元素）/短文本
 */

const BLOCK_SELECTOR =
  'p, h1, h2, h3, h4, h5, h6, li, blockquote, dd, dt, td, th, figcaption, summary';

const SKIP_ANCESTOR =
  'code, pre, kbd, samp, script, style, noscript, textarea, select, svg, math, [translate="no"], [contenteditable="true"], .imt-rebuild-floatball-wrap';

/** 已翻译过的 wrapper 标记 class（renderer 维护） */
export const WRAPPER_CLASS = 'imt-rebuild-target-wrapper';

function isVisible(el: HTMLElement): boolean {
  const rects = el.getClientRects();
  if (rects.length === 0) return false;
  const style = getComputedStyle(el);
  if (style.visibility === 'hidden' || Number(style.opacity) <= 0.05) return false;
  // 尺寸退化的元素（SEO 用的 position:absolute;width:1px;height:1px）不是给人看的，
  // 翻译它只会浪费请求且用户完全看不到（x.com 的隐藏 h1 就属此类，实测踩过）
  let maxW = 0;
  let maxH = 0;
  for (const r of rects) {
    maxW = Math.max(maxW, r.width);
    maxH = Math.max(maxH, r.height);
  }
  return maxW > 2 && maxH > 2;
}

/** 是否含嵌套块级元素（只取最内层段落，避免重复翻译） */
function hasNestedBlock(el: HTMLElement): boolean {
  return el.querySelector(BLOCK_SELECTOR) !== null;
}

/** el 自身或祖先是否命中规则排除选择器 */
function isRuleExcluded(el: HTMLElement, rule: SiteRule): boolean {
  for (const sel of rule.excludeSelectors ?? []) {
    try {
      if (el.matches(sel) || el.closest(sel)) return true;
    } catch {
      /* 非法选择器忽略 */
    }
  }
  return false;
}

export interface WalkOptions {
  charBudget?: number; // 最多收集的累计字符数（原版 preTranslateChars = 4999）
}

export interface Paragraph {
  el: HTMLElement;
  text: string; // 规范化文本
}

/** 主区域选择（优先级：main > article > #content > .content > body） */
function findMainRoot(): HTMLElement {
  return (
    (document.querySelector('main') as HTMLElement) ??
    (document.querySelector('article') as HTMLElement) ??
    (document.querySelector('#content') as HTMLElement) ??
    (document.querySelector('.content') as HTMLElement) ??
    document.body
  );
}

/**
 * 候选元素收集
 * - 规则模式：按 selectors 顺序 querySelectorAll，去掉「祖先也在候选集里」的元素
 *   （否则推文容器的每个 span 都会被当独立段落，一句话被切碎）
 * - 启发式模式：主区域内的块级标签
 */
function gatherCandidates(rule: SiteRule | null): HTMLElement[] {
  if (rule?.selectors?.length) {
    const list: HTMLElement[] = [];
    const seen = new Set<HTMLElement>();
    for (const sel of rule.selectors) {
      let nodes: NodeListOf<Element>;
      try {
        nodes = document.querySelectorAll(sel);
      } catch {
        continue; // 站点规则里的选择器写错不应影响整页
      }
      for (const node of nodes) {
        const el = node as HTMLElement;
        if (seen.has(el)) continue;
        seen.add(el);
        list.push(el);
      }
    }
    // 只保留最外层候选：避免容器与其内部段落重复翻译
    const set = new Set(list);
    return list.filter((el) => {
      for (let p = el.parentElement; p; p = p.parentElement) {
        if (set.has(p)) return false;
      }
      return true;
    });
  }
  return [...findMainRoot().querySelectorAll<HTMLElement>(BLOCK_SELECTOR)];
}

/** 单元素是否可收集（规则无关的公共判定） */
function accept(
  el: HTMLElement,
  config: UserConfig,
  rule: SiteRule | null,
  opts: { minChars: number; requireVisible: boolean; applyNestedBlock: boolean },
): string | null {
  if (el.closest(SKIP_ANCESTOR)) return null;
  if (el.querySelector(`.${WRAPPER_CLASS}`)) return null; // 已翻译
  if (rule && isRuleExcluded(el, rule)) return null;
  if (opts.applyNestedBlock && hasNestedBlock(el)) return null;
  if (opts.requireVisible && !isVisible(el)) return null;

  const raw = el.innerText ?? el.textContent ?? '';
  const text = normalizeText(raw);
  if (!isTranslatable(text, opts.minChars)) return null;
  // 同语言段落跳过（可用 engine.sameLangCheck 关闭；x.com 这类站点靠正文采样判定，
  // 不依赖 html[lang]——见 content.ts 的整页判定说明）
  if (config.engine.sameLangCheck && isSameTargetLang(text, config.general.targetLanguage)) return null;
  return text;
}

/**
 * 收集主区域待翻译段落（首屏预翻译用）。
 * 命中站点规则时使用规则的 selectors；否则 main > article > #content > .content > body 的块级标签。
 */
export function collectParagraphs(config: UserConfig, opts: WalkOptions = {}): Paragraph[] {
  const charBudget = opts.charBudget ?? config.engine.preTranslateChars;
  const rule = matchSiteRule(location.href);
  const minChars = rule?.minChars ?? config.engine.minParagraphChars;

  const out: Paragraph[] = [];
  let total = 0;

  for (const el of gatherCandidates(rule)) {
    if (total >= charBudget && out.length > 0) break;
    const text = accept(el, config, rule, {
      minChars,
      requireVisible: true,
      // 规则命中的容器内部允许有块级子元素（推文容器里常见），否则会漏翻；启发式模式仍需去嵌套
      applyNestedBlock: !rule?.selectors?.length,
    });
    if (text === null) continue;
    total += text.length;
    out.push({ el, text });
  }
  return out;
}

/**
 * 收集未翻译的候选段落元素（滚动懒翻译观察用）。
 * 与 collectParagraphs 差异：不截断（charBudget）、不要求可见（IO 触发时自然判断）、
 * 不做文本去重——重复段落靠 background 翻译缓存去重出网，但每个元素都要自己的 wrapper。
 */
export function collectUntranslatedEls(config: UserConfig): HTMLElement[] {
  const rule = matchSiteRule(location.href);
  const minChars = rule?.minChars ?? config.engine.minParagraphChars;
  const out: HTMLElement[] = [];
  for (const el of gatherCandidates(rule)) {
    const ok = accept(el, config, rule, {
      minChars,
      requireVisible: false,
      applyNestedBlock: !rule?.selectors?.length,
    });
    if (ok !== null) out.push(el);
  }
  return out;
}
