import type { UserConfig } from '@/core/config/defaults';
import '@/engine/content.css';
import { collectParagraphs } from '@/engine/walker';
import { isTranslated, restoreTranslation, showTranslation } from '@/engine/renderer';
import { translateTexts } from '@/engine/translator';
import {
  mountFloatBall,
  setFloatBallState,
  unmountFloatBall,
} from '@/engine/floatball';

/**
 * 内容翻译引擎入口（P3 v1）
 * - Alt+A / 悬浮球：主区域段落双语翻译切换
 * - 状态上报 background（badge）；config:changed 热更新悬浮球
 * - 仅译文/模糊学习模式在 P6 接入完整方案
 */

let config: UserConfig | null = null;
let translating = false;

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

/** 页面语言检测（近似：取 <html lang>；对齐原版 sameLangCheck 的轻量版） */
function pageLang(): string {
  return document.documentElement.lang?.split('-')[0]?.toLowerCase() ?? '';
}

function targetLang(c: UserConfig): string {
  const target = c.general.targetLanguage;
  return target.split('-')[0].toLowerCase();
}

async function togglePageTranslation(wholePage = false): Promise<void> {
  if (translating) return;
  const c = await ensureConfig();

  // 扩展总开关（原版关于页「启用扩展」）
  if (!c.app.enabled) return;

  // 同语言检测
  const lang = pageLang();
  if (c.engine.sameLangCheck && lang && lang === targetLang(c)) {
    console.info('[imt-rebuild] 页面语言与目标语言相同，跳过翻译');
    return;
  }

  const paragraphs = collectParagraphs(c, {
    charBudget: wholePage ? 1_000_000 : undefined,
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
    const results = await translateTexts(
      texts,
      'auto',
      c.general.targetLanguage,
      c.general.service,
      'page',
    );
    paragraphs.forEach((p, i) => showTranslation(p.el, results[i] ?? '', c));
    reportStatus('done');
  } catch (e) {
    console.error('[imt-rebuild] translate failed:', e);
    reportStatus('error');
    setFloatBallState(false);
  } finally {
    translating = false;
  }
}

function mountBallWhenReady(): void {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountBallOnce, { once: true });
  } else {
    mountBallOnce();
  }
}

async function mountBallOnce(): Promise<void> {
  const c = await ensureConfig();
  const url = location.href;
  const blocked = (c.floatball.blockUrls ?? []).some((pattern) => {
    try {
      return new RegExp(pattern.replaceAll('*', '.*')).test(url);
    } catch {
      return false;
    }
  });
  if (blocked) return;
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
    browser.runtime.onMessage.addListener((msg: { type?: string; payload?: { command?: string; config?: UserConfig } }) => {
      if (msg?.type === 'command') {
        const command = msg.payload?.command ?? '';
        if (command === 'toggleTranslatePage') void togglePageTranslation();
        else if (command === 'toggleTranslateTheWholePage') void togglePageTranslation(true);
      }
      if (msg?.type === 'config:changed') {
        config = msg.payload?.config ?? config;
        // 悬浮球开关热更新
        if (config && !config.floatball.enabled) unmountFloatBall();
        else mountBallWhenReady();
      }
    });

    mountBallWhenReady();
  },
});
