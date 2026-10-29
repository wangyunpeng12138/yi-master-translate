import type { UserConfig } from '@/core/config/defaults';
import { collectParagraphs, collectUntranslatedEls, WRAPPER_CLASS } from '@/engine/walker';
import { isTranslated, showTranslation } from '@/engine/renderer';
import { translateTexts, PAGE_EPOCH } from '@/engine/translator';
import { isSameTargetLang, isTranslatable, normalizeText } from '@/core/shared/utils';
import { mountFloatBall, setFloatBallStatus, unmountFloatBall } from '@/engine/floatball';
import { initSelection, disposeSelection } from '@/engine/selection';
import { initHover, disposeHover } from '@/engine/hover';
import { initInputBox, disposeInputBox } from '@/engine/inputbox';
import { initCircleSelect, disposeCircleSelect } from '@/engine/circleSelect';
import { initSubtitle, disposeSubtitle } from '@/engine/subtitle';
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
/** 翻译前的原始 title（restore 时还原；防止二次翻译把已译标题再翻，污染原文） */
let originalTitle: string | null = null;

/* ---------- 滚动懒翻译（原版「边看边译」：首屏预翻译 + IntersectionObserver 增量补全） ---------- */
let pageTranslating = false;
let lazyObserver: IntersectionObserver | null = null;
const lazyPending = new Set<HTMLElement>();
let lazyBusy = false;
let lastError = false; // 最近一次主流程翻译是否失败（status:query 用）

function stopLazyTranslate(): void {
  lazyObserver?.disconnect();
  lazyObserver = null;
  lazyPending.clear();
}

async function flushLazy(c: UserConfig): Promise<void> {
  if (lazyBusy) return;
  lazyBusy = true;
  try {
    while (pageTranslating && lazyPending.size > 0) {
      const els = [...lazyPending];
      lazyPending.clear();
      const texts: string[] = [];
      const targets: HTMLElement[] = [];
      for (const el of els) {
        lazyObserver?.unobserve(el);
        if (isTranslated(el)) continue;
        const text = normalizeText(el.innerText ?? el.textContent ?? '');
        if (!isTranslatable(text, c.engine.minParagraphChars)) continue;
        texts.push(text);
        targets.push(el);
      }
      if (texts.length === 0) continue;
      // 懒翻译状态反馈：badge/悬浮球同步（滚动补翻时用户可见进度）
      if (pageTranslating) {
        setFloatBallStatus('translating');
        reportStatus('translating');
      }
      // 分小批逐批翻：单批失败只丢该批（一次消息通道失败不致整页懒翻译全废）
      const BATCH = 24; // 与 translator.CHUNK 对齐，每批恰好一条消息
      for (let i = 0; i < texts.length; i += BATCH) {
        if (!pageTranslating) break; // 中途被 restore
        const slice = texts.slice(i, i + BATCH);
        const targetSlice = targets.slice(i, i + BATCH);
        try {
          const results = await translateTexts(slice, 'auto', c.general.targetLanguage, c.general.service, 'page');
          targetSlice.forEach((el, j) => {
            const translated = results[j] ?? '';
            if (translated && translated !== slice[j]) showTranslation(el, translated, c);
          });
        } catch (e) {
          console.error(`[imt-rebuild] lazy translate failed (batch ${i / BATCH + 1}):`, e);
        }
      }
      if (pageTranslating) {
        setFloatBallStatus('done');
        reportStatus('done');
      }
    }
  } finally {
    lazyBusy = false;
    if (pageTranslating && lazyPending.size > 0) void flushLazy(c); // 处理期间新入视口的兑底
  }
}

function startLazyTranslate(c: UserConfig): void {
  stopLazyTranslate();
  lazyObserver = new IntersectionObserver(
    (entries) => {
      if (!pageTranslating) return;
      // 关键：observe() 注册时每个元素都会异步触发一次初始回调（含 isIntersecting=false 的），
      // 必须只收相交元素，否则全页元素一次性进 pending，懒翻译退化成立即全页翻译
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        lazyPending.add(e.target as HTMLElement);
      }
      if (lazyPending.size > 0) void flushLazy(c);
    },
    // 提前 800px 双向预载（上方扩 800 防快速回滚白屏，下方扩 800 滚动无感）
    { rootMargin: '800px 0px 800px 0px' },
  );
  for (const el of collectUntranslatedEls(c)) lazyObserver.observe(el);
}

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

  // 页面存在任一已译 wrapper → 还原（原版语义：再按一次切回原文）。
  // 判定不能用「本次 collect 到的段落是否全部已翻译」：walker 会跳过已译段落，
  // charBudget 截断/去重/懒加载残留都会使判定失真，把“关闭”误触发成补翻。
  if (document.querySelector(`.${WRAPPER_CLASS}`) || originalTitle !== null) {
    lastError = false;
    document.querySelectorAll(`.${WRAPPER_CLASS}`).forEach((n) => n.remove());
    document.querySelectorAll('[data-imt-rebuild]').forEach((el) => {
      el.removeAttribute('data-imt-rebuild');
      el.classList.remove('imt-rebuild-only-mode');
    });
    if (originalTitle !== null) {
      document.title = originalTitle;
      originalTitle = null;
    }
    pageTranslating = false;
    stopLazyTranslate();
    setFloatBallStatus('idle');
    reportStatus('idle');
    return;
  }

  // 同语言检测（仅翻译分支；已翻译页面上的关闭操作不受此拦截）
  const lang = pageLang();
  if (c.engine.sameLangCheck && lang && lang === targetLang(c)) {
    console.info('[imt-rebuild] 页面语言与目标语言相同，跳过翻译');
    return;
  }

  const paragraphs = collectParagraphs(c, {
    charBudget: wholePage || c.engine.translateWholePage ? 1_000_000 : undefined,
  });
  if (paragraphs.length === 0) return;

  translating = true;
  lastError = false;
  setFloatBallStatus('translating');
  reportStatus('translating');
  try {
    const texts = paragraphs.map((p) => p.text);
    const results = await translateTexts(texts, 'auto', c.general.targetLanguage, c.general.service, 'page');
    // 「译文==原文」不插 wrapper：纯数字/目录编号等无需翻译段，以及服务原样返回的段
    paragraphs.forEach((p, i) => {
      const translated = results[i] ?? '';
      if (translated && translated !== texts[i]) showTranslation(p.el, translated, c);
    });
    if (c.engine.translateTitle) void translateTitle(c);
    reportStatus('done');
    setFloatBallStatus('done');
    // 首屏完成后启动滚动增量：剩余段落进入视口前 800px 时自动补翻（边看边译）
    pageTranslating = true;
    startLazyTranslate(c);
  } catch (e) {
    console.error('[imt-rebuild] translate failed:', e);
    lastError = true;
    reportStatus('error');
    setFloatBallStatus('error');
  } finally {
    translating = false;
  }
}

async function translateTitle(c: UserConfig): Promise<void> {
  const title = document.title;
  if (!title) return;
  // 中文标题（目标语言段落）不翻：避免反向互译污染
  if (isSameTargetLang(title, c.general.targetLanguage)) return;
  // 首次覆盖前留存原文（restore 分支恢复）
  if (originalTitle === null) originalTitle = title;
  const out = await translateTexts([title], 'auto', c.general.targetLanguage, c.general.service, 'page');
  if (out[0]) document.title = out[0];
}

/* ---------- 交互层装配 ---------- */

function disposeInteractions(): void {
  disposeSelection();
  disposeHover();
  disposeInputBox();
  disposeCircleSelect();
  disposeSubtitle();
}

function setupInteractions(c: UserConfig): void {
  disposeInteractions();
  initSelection(c);
  initHover(c);
  initInputBox(c);
  initCircleSelect(c);
  initSubtitle(c);
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
  // 快捷键命令分发（background 转发）+ 页面世代探活应答
  browser.runtime.onMessage.addListener(
    (
      msg: { type?: string; payload?: { command?: string; config?: UserConfig; srcUrl?: string; x?: number; y?: number; epoch?: string } },
      _sender: unknown,
      sendResponse: (response: unknown) => void,
    ) => {
      // background 批处理世代检查：同世代（同一页面实例）才应答，导航后的新实例不认旧批次。
      // 注意：原生 Chrome 消息协议同步返回普通对象会被忽略，必须 sendResponse + return true
      if (msg?.type === 'tab:check') {
        sendResponse({ ok: msg.payload?.epoch === PAGE_EPOCH });
        return true; // 保持消息通道直到 sendResponse 完成
      }
      // 状态直查（popup 打开时初始回显 / badge 刷新）：页面是状态权威源，不落存防 SW 生命周期丢失
      if (msg?.type === 'status:query') {
        const state = translating
          ? 'translating'
          : pageTranslating || document.querySelector(`.${WRAPPER_CLASS}`)
            ? 'done'
            : lastError
              ? 'error'
              : 'idle';
        sendResponse({ state });
        return true;
      }
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
          // 翻译中收到新配置：懒翻译观察器重启，新段落用新配置（目标语言/服务）
          if (pageTranslating) startLazyTranslate(config);
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
      // 新页面实例声明 idle 状态：覆盖 background 的 per-tab 状态表
      // （导航后旧状态清除；popup/badge 打开时能拿到正确初始状态）
      reportStatus('idle');
    });
  },
});
