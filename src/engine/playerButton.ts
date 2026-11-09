import type { UserConfig } from '@/core/config/defaults';
import {
  disableVideoSubtitle,
  enableVideoSubtitle,
  getVideoSubtitleState,
} from './subtitle';

/**
 * 播放器「CC」快捷按钮 + 字幕设置浮层
 *
 * 对齐参考实现的 quickButtonRule（播放器控制条插按钮 → 点开快捷面板），差异：
 * - 锚点用「音量优先 → 设置/全屏簇兜底」的链式解析（x.com 新播放器没有独立音量按钮）
 * - 浮层用 Shadow DOM 隔离，避免站点 CSS 污染（参考实现用注入了大量 !important 的全局 CSS）
 * - 面板里的「此视频字幕」开关直接控制该视频的字幕加载与翻译（轨道翻译 / ASR）
 */

const BUTTON_ATTR = 'data-imt-cc-button';
const HOST_ATTR = 'data-imt-cc-host';

/** 音量类按钮（有则贴在其后） */
const VOLUME_SELECTORS = [
  'button[aria-label*="静音"]',
  'button[aria-label*="取消静音"]',
  'button[aria-label*="音量"]',
  'button[aria-label*="mute" i]',
  'button[aria-label*="volume" i]',
  '.vjs-mute-control',
  '.ytp-mute-button',
  '[data-testid="volume"]',
];

/** 兜底：设置 / 全屏 / 字幕 按钮所在的控制簇（插到簇的最左） */
const CLUSTER_SELECTORS = [
  'button[aria-label*="设置"]',
  'button[aria-label*="Settings" i]',
  'button[aria-label*="字幕"]',
  'button[aria-label*="Captions" i]',
  'button[aria-label*="全屏"]',
  'button[aria-label*="Full screen" i]',
  '.vjs-fullscreen-control',
  '.ytp-fullscreen-button',
];

interface Anchor {
  container: HTMLElement;
  reference: HTMLElement;
  mode: 'after' | 'before';
}

function findAnchor(video: HTMLVideoElement): Anchor | null {
  const root = (video.parentElement?.parentElement ?? video.parentElement ?? document.body) as HTMLElement;
  const pick = (selectors: string[]): HTMLElement | null => {
    for (const sel of selectors) {
      const el = root.querySelector(sel);
      if (el && el.parentElement) return el as HTMLElement;
    }
    return null;
  };
  const vol = pick(VOLUME_SELECTORS);
  if (vol?.parentElement) return { container: vol.parentElement, reference: vol, mode: 'after' };
  const cluster = pick(CLUSTER_SELECTORS);
  if (cluster?.parentElement) return { container: cluster.parentElement, reference: cluster, mode: 'before' };
  return null;
}

/** 面板每一行的容器 */
function row(label: string): HTMLElement {
  const el = document.createElement('div');
  el.className = 'row';
  el.dataset.label = label;
  return el;
}

const PANEL_CSS = `
:host { all: initial; }
.panel {
  position: fixed; z-index: 2147483646; width: 240px;
  background: rgba(24,24,27,.97); color: #f4f4f5;
  border: 1px solid rgba(255,255,255,.12); border-radius: 12px;
  box-shadow: 0 12px 32px rgba(0,0,0,.45);
  font: 13px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif;
  padding: 10px 0; user-select: none;
}
.title { padding: 2px 14px 8px; font-weight: 600; font-size: 13px; opacity: .9; }
.row { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 7px 14px; }
.row:hover { background: rgba(255,255,255,.06); cursor: pointer; }
.row .k { opacity: .92; }
.row .v { opacity: .62; font-size: 12px; display: flex; align-items: center; gap: 4px; }
.sep { height: 1px; background: rgba(255,255,255,.1); margin: 6px 0; }
.switch { width: 34px; height: 18px; border-radius: 9px; background: rgba(255,255,255,.22); position: relative; transition: background .15s; flex: none; }
.switch::after { content: ''; position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%; background: #fff; transition: transform .15s; }
.switch.on { background: #10b981; }
.switch.on::after { transform: translateX(16px); }
.hint { padding: 4px 14px 0; font-size: 11px; opacity: .5; }
`;

let currentPanelCleanup: (() => void) | null = null;

function closePanel(): void {
  currentPanelCleanup?.();
  currentPanelCleanup = null;
}

function openPanel(button: HTMLElement, video: HTMLVideoElement, config: UserConfig, onChanged: () => void): void {
  closePanel();
  const host = document.createElement('div');
  host.setAttribute(HOST_ATTR, '1');
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = PANEL_CSS;
  const panel = document.createElement('div');
  panel.className = 'panel';
  shadow.append(style, panel);

  const state = getVideoSubtitleState(video);
  const displayMode = config.subtitle.displayMode;
  const position = config.subtitle.translationPosition;

  const rowEl = (label: string, valueHtml: string) => {
    const el = row(label);
    const k = document.createElement('span');
    k.className = 'k';
    k.textContent = label;
    const v = document.createElement('span');
    v.className = 'v';
    v.innerHTML = valueHtml;
    el.append(k, v);
    panel.append(el);
    return el;
  };

  const titleEl = document.createElement('div');
  titleEl.className = 'title';
  titleEl.textContent = '字幕设置';
  panel.append(titleEl);

  // ① 此视频字幕开关（核心：手动开/关该视频的字幕加载与翻译）
  const toggleRow = rowEl(
    '此视频字幕',
    `<span class="switch ${state.active ? 'on' : ''}"></span>
     <span>${state.active ? (state.source === 'asr' ? '语音识别中' : '已开启') : '已关闭'}</span>`,
  );
  toggleRow.addEventListener('click', async (e) => {
    e.stopPropagation();
    const now = getVideoSubtitleState(video);
    if (now.active) {
      disableVideoSubtitle(video);
    } else {
      try {
        await enableVideoSubtitle(video, config);
      } catch (err) {
        console.warn('[imt-rebuild] 开启字幕失败：', err);
      }
    }
    onChanged();
    closePanel();
  });

  // ② 显示类型
  const modeRow = rowEl('字幕显示类型', `${displayMode === 'only' ? '仅译文' : '双语字幕'} ›`);
  modeRow.addEventListener('click', (e) => {
    e.stopPropagation();
    const next = config.subtitle.displayMode === 'only' ? 'dual' : 'only';
    void patchConfig({ subtitle: { displayMode: next } });
    closePanel();
  });

  // ③ 译文位置
  const posRow = rowEl('译文位置', `${position === 'above' ? '原文上方' : '原文下方'} ›`);
  posRow.addEventListener('click', (e) => {
    e.stopPropagation();
    const next: 'above' | 'below' = config.subtitle.translationPosition === 'above' ? 'below' : 'above';
    void patchConfig({ subtitle: { translationPosition: next } });
    closePanel();
  });

  const sep = document.createElement('div');
  sep.className = 'sep';
  panel.append(sep);

  // ④ 字幕样式（跳设置页）
  const styleRow = rowEl('字幕样式', '›');
  styleRow.addEventListener('click', (e) => {
    e.stopPropagation();
    void browser.runtime.sendMessage({ type: 'openOptions', payload: { hash: 'subtitle' } }).catch(() => undefined);
    closePanel();
  });

  // ⑤ 不再显示该快捷方式（站点级）
  const hideRow = rowEl('不再显示该快捷方式', '');
  hideRow.addEventListener('click', (e) => {
    e.stopPropagation();
    const host_ = location.hostname;
    const hosts = new Set(config.subtitle.hiddenShortcutHosts ?? []);
    hosts.add(host_);
    void patchConfig({ subtitle: { hiddenShortcutHosts: [...hosts] } });
    closePanel();
  });

  // ⑥ 更多功能
  const moreRow = rowEl('更多功能', '›');
  moreRow.addEventListener('click', (e) => {
    e.stopPropagation();
    void browser.runtime.sendMessage({ type: 'openOptions', payload: {} }).catch(() => undefined);
    closePanel();
  });

  const hint = document.createElement('div');
  hint.className = 'hint';
  hint.textContent = config.asr.enabled ? '无字幕视频将使用语音识别' : '可在设置页开启无字幕视频的语音识别';
  panel.append(hint);

  document.body.append(host);
  const rect = button.getBoundingClientRect();
  const panelRect = { height: panel.offsetHeight || 260 };
  panel.style.left = `${Math.max(8, Math.min(rect.right - 240, window.innerWidth - 248))}px`;
  panel.style.top = `${Math.max(8, rect.top - panelRect.height - 8)}px`;

  const onDocClick = (ev: MouseEvent) => {
    if (!host.contains(ev.target as Node)) closePanel();
  };
  const onKey = (ev: KeyboardEvent) => {
    if (ev.key === 'Escape') closePanel();
  };
  setTimeout(() => document.addEventListener('mousedown', onDocClick, true), 0);
  document.addEventListener('keydown', onKey, true);
  currentPanelCleanup = () => {
    document.removeEventListener('mousedown', onDocClick, true);
    document.removeEventListener('keydown', onKey, true);
    host.remove();
  };
}

async function patchConfig(patch: unknown): Promise<void> {
  await browser.runtime
    .sendMessage({ type: 'config:set', payload: { patch } })
    .catch(() => undefined);
}

const attached = new WeakMap<HTMLVideoElement, HTMLElement>();

/**
 * 创建 CC 芯片（浮层形态）
 * 为什么不直接插进站点控制条：站点的控制条容器常带 pointer-events:none，
 * 且上面还压着渐变/scrim 覆盖层（实测 x.com：elementFromPoint 命中的是站点层），
 * 插进 DOM 看起来对、但鼠标点不到。改成 fixed 浮层 + 最高 z-index：
 * 位置跟随控制条里的锚点按钮，点击永远命中我们。
 */
function createChip(video: HTMLVideoElement, config: UserConfig): HTMLElement {
  const host = document.createElement('div');
  host.setAttribute(BUTTON_ATTR, '1');
  Object.assign(host.style, {
    position: 'fixed',
    zIndex: '2147483646',
    display: 'none',
    width: '28px',
    height: '24px',
    pointerEvents: 'auto',
  } as Partial<CSSStyleDeclaration>);

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = 'CC';
  btn.title = '字幕设置（译大师）';
  Object.assign(btn.style, {
    width: '100%',
    height: '100%',
    padding: '0',
    border: 'none',
    borderRadius: '6px',
    background: 'rgba(0,0,0,.55)',
    color: '#fff',
    font: '600 11px/24px system-ui, sans-serif',
    cursor: 'pointer',
    display: 'block',
    pointerEvents: 'auto',
  } as Partial<CSSStyleDeclaration>);
  host.append(btn);

  const refresh = () => {
    const st = getVideoSubtitleState(video);
    btn.style.background = st.active ? 'rgba(16,185,129,.95)' : 'rgba(0,0,0,.55)';
    btn.title = st.active
      ? `字幕已开启（${st.source === 'asr' ? '语音识别' : '站点字幕轨'}），点击设置`
      : '点击开启字幕';
  };
  refresh();

  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    openPanel(btn, video, config, refresh);
  });
  (host as HTMLElement & { __imtRefresh?: () => void }).__imtRefresh = refresh;
  return host;
}

/** 跟随控制条锚点定位（控制条隐藏时同步隐藏） */
function syncChipPosition(video: HTMLVideoElement, chip: HTMLElement): void {
  const anchor = findAnchor(video);
  if (!anchor) {
    chip.style.display = 'none';
    return;
  }
  const r = anchor.reference.getBoundingClientRect();
  if (r.width < 4 || r.height < 4) {
    chip.style.display = 'none';
    return;
  }
  chip.style.display = 'block';
  const left = anchor.mode === 'after' ? r.right + 4 : r.left - 32;
  chip.style.left = `${Math.round(left)}px`;
  chip.style.top = `${Math.round(r.top + (r.height - 24) / 2)}px`;
}

/** 给单个视频挂芯片（幂等；芯片被关掉/被站点移走会重建） */
export function attachPlayerButton(video: HTMLVideoElement, config: UserConfig): void {
  const existing = attached.get(video);
  if (existing && existing.isConnected) {
    (existing as HTMLElement & { __imtRefresh?: () => void }).__imtRefresh?.();
    return;
  }
  const chip = createChip(video, config);
  document.body.append(chip);
  attached.set(video, chip);
  syncChipPosition(video, chip);
}

/** 页面级：为所有视频挂芯片（幂等，可被节流调用） */
export function attachPlayerButtons(config: UserConfig): void {
  if (!config.subtitle.showPlayerShortcut || config.subtitle.permanentDisable) return;
  if ((config.subtitle.hiddenShortcutHosts ?? []).includes(location.hostname)) return;
  document.querySelectorAll('video').forEach((v) => attachPlayerButton(v as HTMLVideoElement, config));
}

let mo: MutationObserver | null = null;
let attachTimer: number | undefined;
let tickTimer: number | undefined;
let activeConfig: UserConfig | null = null;

/** 位置跟随：控制条位置随滚动/全屏/悬停变化，低频同步即可 */
function startTicker(): void {
  if (tickTimer) return;
  tickTimer = window.setInterval(() => {
    document.querySelectorAll('video').forEach((v) => {
      const chip = attached.get(v as HTMLVideoElement);
      if (chip && chip.isConnected) syncChipPosition(v as HTMLVideoElement, chip);
    });
  }, 400);
}

/** 去抖：站点 DOM 抖动剧烈（X 每秒上千次 mutation），全量 attach 必须节流 */
function scheduleAttach(): void {
  if (attachTimer || !activeConfig) return;
  attachTimer = window.setTimeout(() => {
    attachTimer = undefined;
    if (activeConfig) attachPlayerButtons(activeConfig);
  }, 300);
}

export function initPlayerButton(config: UserConfig): void {
  disposePlayerButton();
  activeConfig = config;
  attachPlayerButtons(config);
  startTicker();
  mo = new MutationObserver(() => scheduleAttach());
  mo.observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('play', onMediaEvent, true);
  document.addEventListener('pause', onMediaEvent, true);
}

function onMediaEvent(e: Event): void {
  const v = e.target as HTMLVideoElement;
  if (v?.tagName !== 'VIDEO') return;
  const chip = attached.get(v);
  if (chip?.isConnected) (chip as HTMLElement & { __imtRefresh?: () => void }).__imtRefresh?.();
}

export function disposePlayerButton(): void {
  mo?.disconnect();
  mo = null;
  activeConfig = null;
  if (attachTimer) {
    window.clearTimeout(attachTimer);
    attachTimer = undefined;
  }
  if (tickTimer) {
    window.clearInterval(tickTimer);
    tickTimer = undefined;
  }
  document.removeEventListener('play', onMediaEvent, true);
  document.removeEventListener('pause', onMediaEvent, true);
  closePanel();
  document.querySelectorAll(`[${BUTTON_ATTR}]`).forEach((n) => n.remove());
  document.querySelectorAll(`[${HOST_ATTR}]`).forEach((n) => n.remove());
}
