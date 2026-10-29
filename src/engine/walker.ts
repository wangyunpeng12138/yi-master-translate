import { isTranslatable, normalizeText } from '@/core/shared/utils';
import type { UserConfig } from '@/core/config/defaults';

/**
 * 段落识别器（ParagraphWalker）
 * - 未命中站点规则时使用启发式选择器（对齐原版智能识别主区域的思路）
 * - 跳过：代码/脚本/不可见/短文本/嵌套块
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
  return style.visibility !== 'hidden' && Number(style.opacity) > 0.05;
}

/** 是否含嵌套块级元素（只取最内层段落，避免重复翻译） */
function hasNestedBlock(el: HTMLElement): boolean {
  return el.querySelector(BLOCK_SELECTOR) !== null;
}

export interface WalkOptions {
  charBudget?: number; // 最多收集的累计字符数（原版 preTranslateChars = 4999）
}

export interface Paragraph {
  el: HTMLElement;
  text: string; // 规范化文本
}

/**
 * 收集主区域待翻译段落。
 * 主区域优先级：main > article > #content > .content > body
 */
export function collectParagraphs(config: UserConfig, opts: WalkOptions = {}): Paragraph[] {
  const charBudget = opts.charBudget ?? config.engine.preTranslateChars;
  const minChars = config.engine.minParagraphChars;
  const root =
    (document.querySelector('main') as HTMLElement) ??
    (document.querySelector('article') as HTMLElement) ??
    (document.querySelector('#content') as HTMLElement) ??
    (document.querySelector('.content') as HTMLElement) ??
    document.body;

  const out: Paragraph[] = [];
  const seen = new Set<string>();
  let total = 0;

  const candidates = root.querySelectorAll<HTMLElement>(BLOCK_SELECTOR);
  for (const el of candidates) {
    if (total >= charBudget && out.length > 0) break;
    if (el.closest(SKIP_ANCESTOR)) continue;
    if (el.querySelector(`.${WRAPPER_CLASS}`)) continue; // 已翻译
    if (hasNestedBlock(el)) continue;
    if (!isVisible(el)) continue;

    const raw = el.innerText ?? el.textContent ?? '';
    const text = normalizeText(raw);
    if (!isTranslatable(text, minChars)) continue;
    if (seen.has(text)) continue; // 去重（模板化 DOM 常见）
    seen.add(text);

    total += text.length;
    out.push({ el, text });
  }
  return out;
}
