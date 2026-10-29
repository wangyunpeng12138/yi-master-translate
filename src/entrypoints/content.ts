import type { UserConfig } from '@/core/config/defaults';
import { collectParagraphs } from '@/engine/walker';
import { isTranslated, restoreTranslation, showTranslation } from '@/engine/renderer';
import { translateTexts } from '@/engine/translator';
import { mountFloatBall, setFloatBallState, unmountFloatBall } from '@/engine/floatball';
import { initSelection, disposeSelection } from '@/engine/selection';
import { initHover, disposeHover } from '@/engine/hover';
import { initInputBox, disposeInputBox } from '@/engine/inputbox';
import { initCircleSelect, disposeCircleSelect } from '@/engine/circleSelect';
import { translateImage } from '@/engine/imageTranslate';
import '@/engine/content.css';

/**
 * 内容翻译引擎入口（P3 主链路 + P6 交互层）
 * - Alt+A / 悬浮球：主区域段落双语翻译切换
 * - 划词 / 悬停 / 输入框空格×3 / 圈选 Z（截图 OCR）
 * - 右键菜单「翻译图片」
 * - config:changed 热更新：重挂悬浮球、重初始化交互
 */

let config: UserConfig | null = null;
let translating = false;
let injectedStyleEl: HTMLStyleElement | null = null;

function reportStatus(state: 'idle' | 'translating' | 'done' | 'error'): void {
  void browser.runtime
    .sendMessage({ type: 'translation:status', payload: { state } })
    .catch(() => undefined);
}

async function ensureConfig(): Promise<UserConfig> {
  if (config) return config;
  config = (await browser.runtime.sendMessage({ type: 'config:get' })) as UserConfig;
  return config;
}

function pageLang(): string {
  return document.documentElement.lang?.split('-')[0]?.toLowerCase() ?? '';
}

function targetLang(c: UserConfig): string {
  return c.general.targetLanguage.split('-')[0].toLowerCase();
}

async function togglePageTranslation(wholePage = false): Promise<void> {
  if (translating) return;
  const c = await ensureConfig();

  if (!c.app.enabled) return;

  // 同语言检测
  const lang = pageLang();
  if (c.engine.sameLangCheck && lang && lang === targetLang(c)) {
    console.info('[imt-rebuild] 页面语言与目标语言相同，跳过翻译');
    return;
  }

  const paragraphs = collectParagraphs(c, {
    charBudget: wholePage || c.engine.translateWholePage ? 1_000_000 : undefined,
  });
  if (paragraphs.length === 0) return;

  // 已全部翻译 → 还原
  const translatedCount = paragraphs.filter((p) => isTranslated(p.el)).length;
  if (translatedCount === paragraphs.length) {
    paragraphs.forEach((p) => restoreTranslation(p.el));
    setFloatBallState(false);
    reportStatus('idle');
    return;
  }

  translating = true;
  setFloatBallState(true);
  reportStatus('translating');
  try {
    const texts = paragraphs.map((p) => p.text);
    const results = await translateTexts(texts, 'auto', c.general.targetLanguage, c.general.service, 'page');
    paragraphs.forEach((p, i) => showTranslation(p.el, results[i] ?? '', c));
    if (c.engine.translateTitle) void translateTitle(c);
    reportStatus('done');
  } catch (e) {
    console.error('[imt-rebuild] translate failed:', e);
    reportStatus('error');
    setFloatBallState(false);
  } finally {
    translating = false;
  }
}

async function translateTitle(c: UserConfig): Promise<void> {
  const title = document.title;
  if (!title) return;
  const out = await translateTexts([title], 'auto', c.general.targetLanguage, c.general.service, 'page');
  if (out[0]) document.title = out[0];
}

/* ---------- 交互层装配 ---------- */

function disposeInteractions(): void {
  disposeSelection();
  disposeHover();
  disposeInputBox();
  disposeCircleSelect();
}

function setupInteractions(c: UserConfig): void {
  disposeInteractions();
  initSelection(c);
  initHover(c);
  initInputBox(c);
  initCircleSelect(c);
  applyInjectedCss(c);
}

function applyInjectedCss(c: UserConfig): void {
  injectedStyleEl?.remove();
  injectedStyleEl = null;
  if (c.developer.injectedCss?.trim()) {
    injectedStyleEl = document.createElement('style');
    injectedStyleEl.textContent = c.developer.injectedCss;
    document.documentElement.appendChild(injectedStyleEl);
  }
}

function mountBallWhenReady(): void {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountBallOnce, { once: true });
  } else {
    void mountBallOnce();
  }
}

async function mountBallOnce(): Promise<void> {
  const c = await ensureConfig();
  if (!c.floatball.enabled) return;
  const url = location.href;
  const blocked = (c.floatball.blockUrls ?? []).some((pattern) => {
    try {
      return new RegExp(pattern.replaceAll('*', '.*')).test(url);
    } catch {
      return false;
    }
  });
  if (blocked) return;
  unmountFloatBall();
  mountFloatBall({
    enabled: c.floatball.enabled,
    transparency: c.floatball.transparency,
    hoverDelayMs: c.floatball.hoverDelayMs,
    onClick: () => void togglePageTranslation(),
  });
}

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_start',
  main() {
    // 快捷键命令分发（background 转发）
    browser.runtime.onMessage.addListener(
      (msg: { type?: string; payload?: { command?: string; config?: UserConfig; srcUrl?: string; x?: number; y?: number } }) => {
        if (msg?.type === 'command') {
          const command = msg.payload?.command ?? '';
          if (command === 'toggleTranslatePage') void togglePageTranslation();
          else if (command === 'toggleTranslateTheWholePage') void togglePageTranslation(true);
        }
        if (msg?.type === 'config:changed') {
          config = msg.payload?.config ?? config;
          if (config) {
            // 热更新：悬浮球 + 交互层
            if (!config.floatball.enabled) unmountFloatBall();
            else void mountBallOnce();
            setupInteractions(config);
          }
        }
        if (msg?.type === 'translateImage' && msg.payload?.srcUrl) {
          void ensureConfig().then((c) =>
            translateImage(msg.payload!.srcUrl as string, msg.payload?.x ?? 120, msg.payload?.y ?? 120, c),
          );
        }
      },
    );

    void ensureConfig().then((c) => {
      setupInteractions(c);
      mountBallWhenReady();
    });
  },
});
