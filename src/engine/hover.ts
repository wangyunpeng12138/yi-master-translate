import type { UserConfig } from '@/core/config/defaults';
import { isTranslatable, normalizeText } from '@/core/shared/utils';
import { isTranslated, restoreTranslation, showTranslation } from './renderer';
import { translateTexts } from './translator';

/**
 * 鼠标悬停翻译（P6）
 * - holdKey（altKey/ctrlKey/metaKey/shiftKey，Off=禁用）按住时，鼠标悬停段落即翻译
 * - 复用 renderer 的双语渲染；再次悬停已翻译段落则还原
 */

let config: UserConfig | null = null;
let lastEl: HTMLElement | null = null;

const BLOCK_SELECTOR = 'p, h1, h2, h3, h4, h5, h6, li, blockquote, dd, dt, td, th, figcaption';

export function initHover(c: UserConfig): void {
  config = c;
  if (!c.hover.holdKey || c.hover.holdKey === 'Off') return;
  document.addEventListener('mouseover', onMouseOver, { passive: true });
}

export function disposeHover(): void {
  document.removeEventListener('mouseover', onMouseOver);
  lastEl = null;
}

function onMouseOver(e: MouseEvent): void {
  const c = config;
  if (!c || !c.hover.holdKey || c.hover.holdKey === 'Off') return;
  const target = e.target as HTMLElement | null;
  if (!target || !(e as MouseEvent & Record<string, unknown>)[c.hover.holdKey]) {
    lastEl = null;
    return;
  }
  const el = target.closest<HTMLElement>(BLOCK_SELECTOR);
  if (!el || el === lastEl) return;
  lastEl = el;
  void translateHovered(el, c);
}

async function translateHovered(el: HTMLElement, c: UserConfig): Promise<void> {
  const text = normalizeText(el.innerText ?? el.textContent ?? '');
  if (!isTranslatable(text, c.engine.minParagraphChars)) return;

  if (isTranslated(el)) {
    restoreTranslation(el);
    return;
  }
  const out = await translateTexts(
    [text],
    'auto',
    c.general.targetLanguage,
    c.hover.service,
    'hover',
  );
  showTranslation(el, out[0] ?? '', c);
}
