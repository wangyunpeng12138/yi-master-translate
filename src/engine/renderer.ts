import type { UserConfig } from '@/core/config/defaults';
import { WRAPPER_CLASS } from './walker';

/**
 * 双语渲染器（BilingualRenderer）
 * - wrapper：<span class="imt-rebuild-target-wrapper imt-rebuild-theme-{name}">译文</span>
 * - translationPosition：译文在原文前 / 后
 * - 主题（对齐原版「译文显示样式」）：none / dashed / background / blur（学习模式模糊）
 * - loading：翻译请求发出时立即插入占位（原版 loadingTheme 语义：spinner / text / none），
 *   译文到达后替换——AI 服务逐段推理慢，无占位会让用户长时间无反馈
 */

export const LOADING_CLASS = 'imt-rebuild-loading';

export function showLoading(el: HTMLElement, config: UserConfig): void {
  const theme = config.engine.loadingTheme || 'spinner';
  if (theme === 'none') return;
  if (el.querySelector(`:scope > .${LOADING_CLASS}`)) return;
  const loading = document.createElement('span');
  loading.className = LOADING_CLASS;
  loading.textContent = theme === 'text' ? '翻译中…' : '⟳';
  if (config.general.translationPosition === 'before') el.insertBefore(loading, el.firstChild);
  else el.appendChild(loading);
}

function removeLoading(el: HTMLElement): void {
  el.querySelectorAll(`:scope > .${LOADING_CLASS}`).forEach((n) => n.remove());
}

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
  removeLoading(el);
  el.setAttribute('data-imt-rebuild', 'translated');

  // 仅译文模式（P3 简化：原文淡化显示，P6 升级为完全隐藏方案）
  el.classList.toggle('imt-rebuild-only-mode', config.general.displayMode === 'only');
}

export function restoreTranslation(el: HTMLElement): void {
  el.querySelectorAll(`:scope > .${WRAPPER_CLASS}`).forEach((n) => n.remove());
  el.querySelectorAll(`:scope > .${LOADING_CLASS}`).forEach((n) => n.remove());
  el.removeAttribute('data-imt-rebuild');
  el.classList.remove('imt-rebuild-only-mode');
}

export function isTranslated(el: HTMLElement): boolean {
  return el.querySelector(`:scope > .${WRAPPER_CLASS}`) !== null;
}
