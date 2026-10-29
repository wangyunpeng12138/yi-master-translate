import { isSameTargetLang, isTranslatable, normalizeText } from '@/core/shared/utils';
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
 * 收集主区域待翻译段落（首屏预翻译用）。
 * 主区域优先级：main > article > #content > .content > body
 */
export function collectParagraphs(config: UserConfig, opts: WalkOptions = {}): Paragraph[] {
  const charBudget = opts.charBudget ?? config.engine.preTranslateChars;
  const minChars = config.engine.minParagraphChars;
  const root = findMainRoot();

  const out: Paragraph[] = [];
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
    // 段落语言与目标语言相同 → 跳过（中英混排页只翻外文，对齐原版；
    // 同时避免中文段落被服务端检测后反向互译成外语）
    if (isSameTargetLang(text, config.general.targetLanguage)) continue;

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
  const minChars = config.engine.minParagraphChars;
  const out: HTMLElement[] = [];
  const candidates = findMainRoot().querySelectorAll<HTMLElement>(BLOCK_SELECTOR);
  for (const el of candidates) {
    if (el.closest(SKIP_ANCESTOR)) continue;
    if (el.querySelector(`.${WRAPPER_CLASS}`)) continue; // 已翻译
    if (hasNestedBlock(el)) continue; // 只取最内层
    const raw = el.innerText ?? el.textContent ?? '';
    const text = normalizeText(raw);
    if (!isTranslatable(text, minChars)) continue;
    // 同 collectParagraphs：目标语言段落不收集（懒翻译同语义）
    if (isSameTargetLang(text, config.general.targetLanguage)) continue;
    out.push(el);
  }
  return out;
}
