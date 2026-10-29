import type { UserConfig } from '@/core/config/defaults';
import { isTranslatable } from '@/core/shared/utils';
import { translateTexts } from './translator';

/**
 * 输入框翻译（P6）
 * - 可编辑元素（input/textarea/contenteditable）中连续按触发键 N 次（默认空格×3，200ms 窗口）→ 整框翻译替换
 * - 对齐原版 inputbox 参数：triggerKey / repeat / timeoutMs
 */

let config: UserConfig | null = null;
let hits: number[] = [];

export function initInputBox(c: UserConfig): void {
  config = c;
  if (!c.inputbox.enabled) return;
  document.addEventListener('keydown', onKeyDown, true);
  document.addEventListener('mousedown', () => { hits = []; }, true);
}

export function disposeInputBox(): void {
  document.removeEventListener('keydown', onKeyDown, true);
}

function isEditable(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || el.isContentEditable;
}

function onKeyDown(e: KeyboardEvent): void {
  const c = config;
  if (!c || !c.inputbox.enabled) return;
  if (!isEditable(e.target)) {
    hits = [];
    return;
  }
  const expected = c.inputbox.triggerKey === 'enter' ? 'Enter' : ' ';
  if (e.key !== expected) {
    if (hits.length > 0 && Date.now() - hits[hits.length - 1] > c.inputbox.timeoutMs) hits = [];
    return;
  }
  const now = Date.now();
  if (hits.length > 0 && now - hits[hits.length - 1] > c.inputbox.timeoutMs) hits = [];
  hits.push(now);
  if (hits.length < c.inputbox.repeat) return;

  hits = [];
  e.preventDefault();
  e.stopPropagation();
  void translateInput(e.target as HTMLElement, c);
}

async function translateInput(el: HTMLElement, c: UserConfig): Promise<void> {
  // 读取整框文本
  let text = '';
  let set: (v: string) => void;
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    text = el.value;
    set = (v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };
  } else {
    text = el.innerText;
    set = (v) => { el.innerText = v; };
  }
  if (!isTranslatable(text, 2)) return;

  // 目标语言：自动识别页面语言（简化版）/ 对话场景默认 / 用户设定
  let target = c.inputbox.targetLanguage;
  if (c.inputbox.autoDetectPageLang) {
    const pageLang = document.documentElement.lang?.split('-')[0]?.toLowerCase();
    if (pageLang && pageLang !== 'zh') target = pageLang;
  }

  const out = await translateTexts([text], 'auto', target, c.inputbox.service, 'input');
  if (out[0]) set(out[0]);
}
