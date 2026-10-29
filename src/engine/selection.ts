import type { UserConfig } from '@/core/config/defaults';
import { isTranslatable, normalizeText } from '@/core/shared/utils';
import { destroyPanel, showResultPanel, type PanelResult } from './panel';
import { translateTexts } from './translator';

/**
 * 划词翻译（P6）
 * - selectionchange 监听 → 选中文本后显示触发按钮（icon / dot 两种样式）
 * - 点击按钮 → AI 服务翻译 → 弹窗显示
 */

const BTN_CLASS = 'imt-rebuild-sel-btn';

let config: UserConfig | null = null;
let btn: HTMLDivElement | null = null;

export function initSelection(c: UserConfig): void {
  config = c;
  if (!c.selection.enabled) return;
  document.addEventListener('selectionchange', onSelectionChange);
  document.addEventListener('mousedown', onDocMouseDown, true);
  document.addEventListener('scroll', () => removeBtn(), { passive: true });
}

export function disposeSelection(): void {
  document.removeEventListener('selectionchange', onSelectionChange);
  document.removeEventListener('mousedown', onDocMouseDown, true);
  removeBtn();
}

function onDocMouseDown(e: MouseEvent) {
  if (btn && e.target !== btn) removeBtn();
}

function onSelectionChange(): void {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
    removeBtn();
    return;
  }
  const text = normalizeText(sel.toString());
  const c = config;
  if (!c || !isTranslatable(text, 2)) {
    removeBtn();
    return;
  }
  // 禁用站点
  const host = location.host;
  if (c.selection.blockUrls.some((p) => matchesPattern(p, host))) {
    removeBtn();
    return;
  }
  const rect = sel.getRangeAt(0).getBoundingClientRect();
  showBtn(rect.left + rect.width / 2, rect.top, text);
}

function matchesPattern(pattern: string, value: string): boolean {
  try {
    return new RegExp(pattern.replaceAll('*', '.*')).test(value);
  } catch {
    return false;
  }
}

function showBtn(x: number, y: number, text: string): void {
  removeBtn();
  const c = config!;
  btn = document.createElement('div');
  btn.className = BTN_CLASS;
  btn.style.cssText = `position:fixed;left:${Math.max(8, x - 12)}px;top:${Math.max(8, y - 34)}px;z-index:2147483646;
    ${c.selection.triggerStyle === 'dot'
      ? 'width:14px;height:14px;border-radius:50%;background:#ea4c89;box-shadow:0 1px 4px rgba(0,0,0,.3);'
      : 'padding:3px 10px;border-radius:6px;background:#ea4c89;color:#fff;font:12px sans-serif;box-shadow:0 1px 6px rgba(0,0,0,.3);'}
    cursor:pointer;user-select:none;`;
  if (c.selection.triggerStyle !== 'dot') btn.textContent = '译';
  btn.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const cx = e.clientX;
    const cy = e.clientY;
    removeBtn();
    void translateSelection(text, cx, cy);
  });
  document.documentElement.appendChild(btn);
}

function removeBtn(): void {
  btn?.remove();
  btn = null;
}

async function translateSelection(text: string, x: number, y: number): Promise<void> {
  const c = config;
  if (!c) return;
  // 同语言跳过策略
  if (c.selection.sameLangBehavior === 'skip') {
    const pageLang = document.documentElement.lang?.split('-')[0]?.toLowerCase() ?? '';
    const target = c.general.targetLanguage.split('-')[0].toLowerCase();
    if (pageLang && pageLang === target) return;
  }
  destroyPanel();
  const promise = (async (): Promise<PanelResult> => {
    const out = await translateTexts(
      [text],
      'auto',
      c.general.targetLanguage,
      c.selection.service === 'free-ai' ? (c.customServices[0]?.id ?? c.general.service) : c.selection.service,
      'selection',
    );
    const translated = out[0] ?? '';
    // 单词自动朗读
    if (c.selection.autoSpeakWord && /^[\p{L}'-]+$/u.test(text)) {
      try {
        void speak(text);
      } catch { /* ignore */ }
    }
    return { original: text, translated };
  })();
  showResultPanel(x + 12, y + 12, promise);
}

function speak(text: string): Promise<void> {
  return new Promise((resolve) => {
    const u = new SpeechSynthesisUtterance(text);
    u.onend = () => resolve();
    u.onerror = () => resolve();
    speechSynthesis.speak(u);
  });
}
