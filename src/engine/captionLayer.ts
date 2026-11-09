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
  const parent = video.parentElement ?? document.body;
  // 浮层绝对定位需要父容器是定位上下文；静态的话我们临时改成 relative 并记下来
  const patchedPosition = getComputedStyle(parent).position === 'static';
  if (patchedPosition) {
    parent.style.position = 'relative';
    parent.setAttribute('data-imt-asr-pos', '1');
  }

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
  parent.append(host);

  let destroyed = false;
  const updateVisibility = () => {
    const hasText = source.textContent !== '' || target.textContent !== '' || status.textContent !== '';
    host.style.display = hasText && !destroyed ? 'block' : 'none';
  };
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
      host.remove();
      if (patchedPosition) {
        parent.style.removeProperty('position');
        parent.removeAttribute('data-imt-asr-pos');
      }
    },
  };
}
