import type { UserConfig } from '@/core/config/defaults';
import { WRAPPER_CLASS } from './walker';

/**
 * 双语渲染器（BilingualRenderer）
 * - wrapper：<span class="imt-rebuild-target-wrapper imt-rebuild-theme-{name}">译文</span>
 * - translationPosition：译文在原文前 / 后
 * - 主题（对齐原版「译文显示样式」）：none / dashed / background / blur（学习模式模糊）
 */

export function showTranslation(el: HTMLElement, translated: string, config: UserConfig): void {
  const theme = config.general.translationTheme || 'none';
  const position = config.general.translationPosition;

  let wrapper = el.querySelector<HTMLSpanElement>(`:scope > .${WRAPPER_CLASS}`);
  if (!wrapper) {
    wrapper = document.createElement('span');
    wrapper.className = `${WRAPPER_CLASS} imt-rebuild-theme-${theme}`;
    if (position === 'before') el.insertBefore(wrapper, el.firstChild);
    else el.appendChild(wrapper);
  } else {
    wrapper.className = `${WRAPPER_CLASS} imt-rebuild-theme-${theme}`;
  }
  wrapper.textContent = translated;
  el.setAttribute('data-imt-rebuild', 'translated');

  // 仅译文模式（P3 简化：原文淡化显示，P6 升级为完全隐藏方案）
  el.classList.toggle('imt-rebuild-only-mode', config.general.displayMode === 'only');
}

export function restoreTranslation(el: HTMLElement): void {
  el.querySelectorAll(`:scope > .${WRAPPER_CLASS}`).forEach((n) => n.remove());
  el.removeAttribute('data-imt-rebuild');
  el.classList.remove('imt-rebuild-only-mode');
}

export function isTranslated(el: HTMLElement): boolean {
  return el.querySelector(`:scope > .${WRAPPER_CLASS}`) !== null;
}
