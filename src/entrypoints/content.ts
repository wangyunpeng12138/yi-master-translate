import type { UserConfig } from '@/core/config/defaults';
import { collectParagraphs, collectUntranslatedEls, WRAPPER_CLASS } from '@/engine/walker';
import { isTranslated, showLoading, showTranslation } from '@/engine/renderer';
import { translateTexts, PAGE_EPOCH } from '@/engine/translator';
import { isSameTargetLang, isTranslatable, normalizeText } from '@/core/shared/utils';
import { mountFloatBall, setFloatBallStatus, unmountFloatBall } from '@/engine/floatball';
import { initSelection, disposeSelection } from '@/engine/selection';
import { initHover, disposeHover } from '@/engine/hover';
import { initInputBox, disposeInputBox } from '@/engine/inputbox';
import { initCircleSelect, disposeCircleSelect } from '@/engine/circleSelect';
import { initSubtitle, disposeSubtitle } from '@/engine/subtitle';
import { translateImage } from '@/engine/imageTranslate';
import { matchSiteRule } from '@/core/rules';
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
let cancelRequested = false; // 翻译中再点悬浮球 = 终止（已翻内容保留，后续批次停止）

/* ---------- 段落 AI 搜索（术语解释） ---------- */
const EXPLAIN_BTN_CLASS = 'imt-rebuild-explain-btn';
const EXPLAIN_BOX_CLASS = 'imt-rebuild-explain-box';

/** 译文渲染后挂 AI 搜索按钮（附着段落末尾；explain.enabled 控制） */
function attachExplainButton(el: HTMLElement, originalText: string, c: UserConfig): void {
  if (!c.explain.enabled) return;
  if (el.querySelector(`:scope > .${EXPLAIN_BTN_CLASS}`)) return;
  const btn = document.createElement('span');
  btn.className = EXPLAIN_BTN_CLASS;
  btn.title = 'AI 搜索：解释本段术语/典故（缓存命中直接返回）';
  btn.textContent = '🔍';
  btn.dataset.text = originalText;
  el.appendChild(btn);
}

async function handleExplainClick(btn: HTMLElement): Promise<void> {
  const el = btn.parentElement;
  const text = btn.dataset.text ?? '';
  if (!el || !text) return;
  // 已有结果框 → 再点收起
  const exist = el.querySelector(`:scope > .${EXPLAIN_BOX_CLASS}`);
  if (exist) {
    exist.remove();
    return;
  }
  const box = document.createElement('div');
  box.className = EXPLAIN_BOX_CLASS;
  box.textContent = '🔍 AI 搜索中…';
  el.appendChild(box);
  try {
    const r = (await browser.runtime.sendMessage({
      type: 'explain:paragraph',
      payload: { text },
    })) as { content?: string; generatedAt?: number; cached?: boolean };
    if (!r?.content) throw new Error('AI 未返回内容');
    const time = r.generatedAt ? new Date(r.generatedAt).toLocaleString('zh-CN') : '';
    const head = document.createElement('div');
    head.className = 'imt-rebuild-explain-meta';
    head.textContent = `术语解释（${r.cached ? '缓存' : 'AI 生成'} · ${time}）`;
    const body = document.createElement('div');
    body.className = 'imt-rebuild-explain-content';
    body.textContent = r.content;
    box.textContent = '';
    box.append(head, body);
  } catch (e) {
    box.textContent = `🔍 AI 搜索失败：${e instanceof Error ? e.message : String(e)}`;
  }
}

function stopLazyTranslate(): void {
  lazyObserver?.disconnect();
  lazyObserver = null;
  lazyPending.clear();
}

async function flushLazy(c: UserConfig): Promise<void> {
  if (lazyBusy) return;
  lazyBusy = true;
  try {
    while (pageTranslating && !cancelRequested && lazyPending.size > 0) {
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
        if (!pageTranslating || cancelRequested) break; // 中途被 restore / 终止
        const slice = texts.slice(i, i + BATCH);
        const targetSlice = targets.slice(i, i + BATCH);
        targetSlice.forEach((el) => showLoading(el, c)); // 立即反馈
        try {
          const results = await translateTexts(slice, 'auto', c.general.targetLanguage, c.general.service, 'page');
          targetSlice.forEach((el, j) => {
            const translated = results[j] ?? '';
            if (translated && translated !== slice[j]) {
              showTranslation(el, translated, c);
              attachExplainButton(el, slice[j], c); // 懒翻译段同样挂 AI 搜索按钮
            } else {
              removeLoadingInline(el);
            }
          });
        } catch (e) {
          targetSlice.forEach((el) => removeLoadingInline(el));
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

/** 站点规则是否禁止翻译标题（X 的标题恒为「X 上的 xxx」） */
function titleAllowed(): boolean {
  const rule = matchSiteRule(location.href);
  return rule?.translateTitle !== false;
}

async function togglePageTranslation(wholePage = false): Promise<void> {
  // 翻译中再点悬浮球 = 终止翻译（已翻内容保留，后续批次停止；清除 loading 立即反馈）
  if (translating || lazyBusy) {
    cancelRequested = true;
    document.querySelectorAll('.imt-rebuild-loading').forEach((n) => n.remove());
    const hasResult = !!document.querySelector(`.${WRAPPER_CLASS}`);
    setFloatBallStatus(hasResult ? 'done' : 'idle');
    reportStatus(hasResult ? 'done' : 'idle');
    return;
  }
  const c = await ensureConfig();

  if (!c.app.enabled) return;

  // 页面存在任一已译 wrapper → 还原（原版语义：再按一次切回原文）。
  // 判定不能用「本次 collect 到的段落是否全部已翻译」：walker 会跳过已译段落，
  // charBudget 截断/去重/懒加载残留都会使判定失真，把“关闭”误触发成补翻。
  if (document.querySelector(`.${WRAPPER_CLASS}`) || originalTitle !== null) {
    lastError = false;
    cancelRequested = false;
    document.querySelectorAll(`.${WRAPPER_CLASS}`).forEach((n) => n.remove());
    document.querySelectorAll('.' + EXPLAIN_BTN_CLASS + ', .' + EXPLAIN_BOX_CLASS).forEach((n) => n.remove());
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
    document.querySelectorAll('.imt-rebuild-loading').forEach((n) => n.remove());
    setFloatBallStatus('idle');
    reportStatus('idle');
    return;
  }

  // 同语言检测：**不再用 html[lang] 判整页**。
  // x.com / YouTube 等站点把 html[lang] 设成「界面语言」（跟随账号或 IP），
  // 用它判定会把英文推文页面误判成「已是中文」→ 一条不翻（2026-11-09 真机实测）。
  // 改为：段落级用 isSameTargetLang 过滤（walker 内，受 engine.sameLangCheck 控制），
  // 整页全是目标语言时自然收集到 0 段并在下面早退。
  const paragraphs = collectParagraphs(c, {
    charBudget: wholePage || c.engine.translateWholePage ? 1_000_000 : undefined,
  });
  if (paragraphs.length === 0) return;

  translating = true;
  lastError = false;
  cancelRequested = false; // 新一轮翻译开始，清除旧的中断信号
  setFloatBallStatus('translating');
  reportStatus('translating');
  try {
    // 立即给全部待译段落插 loading 占位（原版 loadingTheme 语义）：
    // AI 服务逐段推理慢，无占位会让用户长时间无任何反馈
    paragraphs.forEach((p) => showLoading(p.el, c));
    // 分小批渐进渲染：每批完成立即插入译文（免费通道缓存快、AI 逐段慢都能渐进出结果）
    const BATCH = 8;
    for (let i = 0; i < paragraphs.length; i += BATCH) {
      if (cancelRequested) break; // 用户终止
      if (!translationNotInterrupted()) break; // 中途被 restore
      const slice = paragraphs.slice(i, i + BATCH);
      const texts = slice.map((p) => p.text);
      try {
        const results = await translateTexts(texts, 'auto', c.general.targetLanguage, c.general.service, 'page');
        // 「译文==原文」不插 wrapper：纯数字/目录编号等无需翻译段，以及服务原样返回的段
        slice.forEach((p, j) => {
          const translated = results[j] ?? '';
          if (translated && translated !== texts[j]) {
            showTranslation(p.el, translated, c);
            attachExplainButton(p.el, texts[j], c); // 译文后挂 AI 搜索按钮
          } else {
            removeLoadingInline(p.el); // 无译文段也要清 loading
          }
        });
      } catch (e) {
        // 本批失败：清 loading 并继续后续批（部分成功优于全废）
        slice.forEach((p) => removeLoadingInline(p.el));
        console.error(`[imt-rebuild] translate failed (batch ${i / BATCH + 1}):`, e);
        lastError = true;
      }
    }
    if (cancelRequested) {
      // 终止：已翻内容保留，状态按是否有译文回退（loading 已在 cancel 时清理）
      const hasResult = !!document.querySelector(`.${WRAPPER_CLASS}`);
      reportStatus(hasResult ? 'done' : 'idle');
      setFloatBallStatus(hasResult ? 'done' : 'idle');
      return;
    }
    if (c.engine.translateTitle && titleAllowed()) void translateTitle(c);
    reportStatus(lastError ? 'error' : 'done');
    setFloatBallStatus(lastError ? 'error' : 'done');
    // 首屏完成后启动滚动增量：剩余段落进入视口前 800px 时自动补翻（边看边译）
    pageTranslating = true;
    startLazyTranslate(c);
  } catch (e) {
    console.error('[imt-rebuild] translate failed:', e);
    lastError = true;
    reportStatus('error');
    setFloatBallStatus('error');
    document.querySelectorAll('.imt-rebuild-loading').forEach((n) => n.remove());
  } finally {
    translating = false;
  }
}

/** 翻译是否已被用户切回原文（restore 会移除全部 wrapper/loading，以 DOM 为中断信号） */
function translationNotInterrupted(): boolean {
  return document.querySelector('.imt-rebuild-target-wrapper, .imt-rebuild-loading') !== null;
}

/** 清单段 loading 占位（译文不插入时用） */
function removeLoadingInline(el: HTMLElement): void {
  el.querySelectorAll(':scope > .imt-rebuild-loading').forEach((n) => n.remove());
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
  // 站点规则带来的样式修正（如解除 x.com 的 line-clamp 截断）+ 开发者自定义 CSS
  const ruleCss = matchSiteRule(location.href)?.injectedCss?.join('\n') ?? '';
  const css = [ruleCss, c.developer.injectedCss ?? ''].filter((s) => s.trim()).join('\n');
  if (!css) return;
  injectedStyleEl = document.createElement('style');
  injectedStyleEl.textContent = css;
  document.documentElement.appendChild(injectedStyleEl);
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
      // AI 搜索按钮事件委托（document 级一次绑定，段落渲染后即时可点）
      document.addEventListener('click', (e) => {
        const btn = (e.target as HTMLElement)?.closest?.('.' + EXPLAIN_BTN_CLASS);
        if (btn) {
          e.preventDefault();
          e.stopPropagation();
          void handleExplainClick(btn as HTMLElement);
        }
      });
      // 新页面实例声明 idle 状态：覆盖 background 的 per-tab 状态表
      // （导航后旧状态清除；popup/badge 打开时能拿到正确初始状态）
      reportStatus('idle');
    });
  },
});
