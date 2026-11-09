/**
 * 双语字幕浮层（ASR 用；有字幕轨的视频仍走 track 重写）
 *
 * 结构（对齐 x-com 适配方案 §5.4 的 OverlayChannel）：
 *   <div class="imt-asr-caption-container">
 *     <div class="imt-asr-caption-window">
 *       <span class="imt-asr-source-cue">原文</span>
 *       <span class="imt-asr-target-cue">译文</span>
 *     </div>
 *   </div>
 *
 * 关键点：容器挂在 **video.parentElement** 内 —— 全屏时浮层必须位于全屏元素子树内才能显示。
 */

const HOST_CLASS = 'imt-asr-caption-container';
const WINDOW_CLASS = 'imt-asr-caption-window';

export interface CaptionLayerHandle {
  /** 一行状态提示（识别中/失败），null 清除 */
  setStatus(text: string | null): void;
  /** 显示一条双语字幕；target 为空时只显示原文 */
  show(source: string, target: string): void;
  hide(): void;
  destroy(): void;
  readonly visible: boolean;
}

export interface CaptionLayerOptions {
  /** 译文位置：below = 原文下方（默认），above = 原文上方 */
  translationPosition?: 'below' | 'above';
}

export function createCaptionLayer(video: HTMLVideoElement, opts: CaptionLayerOptions = {}): CaptionLayerHandle {
  const host = document.createElement('div');
  host.className = HOST_CLASS;
  const win = document.createElement('div');
  win.className = `${WINDOW_CLASS}${opts.translationPosition === 'above' ? ' imt-asr-pos-above' : ''}`;
  const source = document.createElement('span');
  source.className = 'imt-asr-source-cue';
  const target = document.createElement('span');
  target.className = 'imt-asr-target-cue';
  const status = document.createElement('span');
  status.className = 'imt-asr-status';

  win.append(source, target, status);
  host.append(win);

  /**
   * 挂载策略：默认挂在 body 上、按视频矩形定位（position:fixed）。
   * 原因：站点（X）重渲染播放器子树时会把注入节点一起冲掉（实测：会话还在、浮层消失）；
   * body 级节点不受影响。全屏时只有全屏元素子树可见 → 这时才挂回 video 的父节点。
   */
  let mountedIn: HTMLElement | null = null;
  const positionFor = () => {
    const fs = document.fullscreenElement as HTMLElement | null;
    const inFullscreen = !!fs && (fs === video || fs.contains(video));
    if (inFullscreen) {
      const parent = (video.parentElement ?? document.body) as HTMLElement;
      if (mountedIn !== parent) {
        parent.append(host);
        mountedIn = parent;
      }
      Object.assign(host.style, { position: 'absolute', left: '0', top: '0', width: '100%', height: '100%' });
      return;
    }
    if (mountedIn !== document.body) {
      document.body.append(host);
      mountedIn = document.body;
    }
    const r = video.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) {
      host.style.display = 'none';
      return;
    }
    Object.assign(host.style, {
      position: 'fixed',
      left: `${Math.round(r.left)}px`,
      top: `${Math.round(r.top)}px`,
      width: `${Math.round(r.width)}px`,
      height: `${Math.round(r.height)}px`,
    } as Partial<CSSStyleDeclaration>);
    if (host.dataset.wantedVisible === '1') host.style.display = 'block';
  };

  const hostStyle: Partial<CSSStyleDeclaration> = {
    position: 'fixed',
    pointerEvents: 'none',
    zIndex: '2147483000',
    display: 'none',
  };
  Object.assign(host.style, hostStyle);
  if (getComputedStyle(host).position !== 'fixed') host.style.position = 'fixed';

  let destroyed = false;
  const updateVisibility = () => {
    const hasText = source.textContent !== '' || target.textContent !== '' || status.textContent !== '';
    host.dataset.wantedVisible = hasText && !destroyed ? '1' : '0';
    if (!hasText || destroyed) {
      host.style.display = 'none';
      return;
    }
    if (mountedIn === document.body) positionFor();
    else host.style.display = 'block';
  };

  // 位置跟随（视频滚动/缩放/全屏切换）
  const syncTimer = window.setInterval(() => {
    if (destroyed) return;
    if (host.dataset.wantedVisible === '1') positionFor();
  }, 400);
  document.addEventListener('fullscreenchange', positionFor);
  document.addEventListener('webkitfullscreenchange', positionFor);
  positionFor();
  updateVisibility();

  return {
    get visible() {
      return host.style.display !== 'none';
    },
    setStatus(text) {
      status.textContent = text ?? '';
      updateVisibility();
    },
    show(src, tgt) {
      // 只在内容变化时写 DOM，避免每帧触发重排
      if (source.textContent !== src) source.textContent = src;
      if (target.textContent !== tgt) target.textContent = tgt;
      updateVisibility();
    },
    hide() {
      if (source.textContent) source.textContent = '';
      if (target.textContent) target.textContent = '';
      updateVisibility();
    },
    destroy() {
      destroyed = true;
      window.clearInterval(syncTimer);
      document.removeEventListener('fullscreenchange', positionFor);
      document.removeEventListener('webkitfullscreenchange', positionFor);
      host.remove();
    },
  };
}
