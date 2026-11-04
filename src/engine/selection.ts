import type { UserConfig } from '@/core/config/defaults';
import { isTranslatable, normalizeText } from '@/core/shared/utils';
import { destroyPanel, showResultPanel, type PanelResult } from './panel';
import { translateTexts } from './translator';

/**
 * 划词翻译 + 划词 AI 搜索（P6 + P11）
 * - selectionchange 监听 → 选中文本后显示触发按钮（icon / dot 两种样式）
 * - 红色按钮：AI 服务翻译 → 弹窗显示译文
 * - 蓝色按钮（AI 搜索）：选中文字的中文解释（含义/语境/背景），独立服务配置
 */

const BTN_CLASS = 'imt-rebuild-sel-btn';
const AI_BTN_CLASS = 'imt-rebuild-sel-ai-btn';

let config: UserConfig | null = null;
let btns: HTMLDivElement[] = [];

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
  if (btns.length > 0 && !btns.includes(e.target as HTMLDivElement)) removeBtn();
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
  const isDot = c.selection.triggerStyle === 'dot';
  const redW = isDot ? 14 : 34; // icon 模式按钮近似宽（文字+左右 padding）
  const gap = 6;
  const redLeft = Math.max(8, x - redW / 2);
  const top = Math.max(8, y - 34);

  // 翻译按钮（红）
  const btn = document.createElement('div');
  btn.className = BTN_CLASS;
  btn.style.cssText = `position:fixed;left:${redLeft}px;top:${top}px;z-index:2147483646;
    ${isDot
      ? 'width:14px;height:14px;border-radius:50%;background:#ea4c89;box-shadow:0 1px 4px rgba(0,0,0,.3);'
      : 'padding:3px 10px;border-radius:6px;background:#ea4c89;color:#fff;font:12px sans-serif;box-shadow:0 1px 6px rgba(0,0,0,.3);'}
    cursor:pointer;user-select:none;`;
  if (!isDot) btn.textContent = '译';
  btn.title = '翻译选中文字';
  btn.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const cx = e.clientX;
    const cy = e.clientY;
    removeBtn();
    void translateSelection(text, cx, cy);
  });
  document.documentElement.appendChild(btn);
  btns.push(btn);

  // AI 搜索按钮（蓝）：解释选中文字的含义/语境/背景
  if (c.selection.aiSearchEnabled) {
    const aiBtn = document.createElement('div');
    aiBtn.className = AI_BTN_CLASS;
    aiBtn.style.cssText = `position:fixed;left:${redLeft + redW + gap}px;top:${top}px;z-index:2147483646;
      ${isDot
        ? 'width:14px;height:14px;border-radius:50%;background:#409eff;box-shadow:0 1px 4px rgba(0,0,0,.3);'
        : 'padding:3px 10px;border-radius:6px;background:#409eff;color:#fff;font:12px sans-serif;box-shadow:0 1px 6px rgba(0,0,0,.3);'}
      cursor:pointer;user-select:none;`;
    if (!isDot) aiBtn.textContent = 'AI';
    aiBtn.title = 'AI 搜索：解释选中文字';
    aiBtn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const cx = e.clientX;
      const cy = e.clientY;
      removeBtn();
      void aiSearchSelection(text, cx, cy);
    });
    document.documentElement.appendChild(aiBtn);
    btns.push(aiBtn);
  }
}

function removeBtn(): void {
  btns.forEach((b) => b.remove());
  btns = [];
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

/** 划词 AI 搜索：选中文字 → AI 生成中文解释（含义/语境/背景），独立服务配置 */
async function aiSearchSelection(text: string, x: number, y: number): Promise<void> {
  destroyPanel();
  const promise = (async (): Promise<PanelResult> => {
    const r = (await browser.runtime.sendMessage({
      type: 'selection:search',
      payload: { text },
    })) as { content?: string } | undefined;
    const content = r?.content?.trim() ?? '';
    if (!content) throw new Error('AI 未返回解释内容');
    return { original: text, translated: content };
  })();
  showResultPanel(x + 12, y + 12, promise, { title: 'AI 搜索', loadingText: 'AI 搜索中…' });
}

function speak(text: string): Promise<void> {
  return new Promise((resolve) => {
    const u = new SpeechSynthesisUtterance(text);
    u.onend = () => resolve();
    u.onerror = () => resolve();
    speechSynthesis.speak(u);
  });
}
