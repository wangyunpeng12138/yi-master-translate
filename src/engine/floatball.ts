/**
 * 悬浮球（FloatBall）：页面右侧快捷翻译按钮
 * P3 版：主按钮点击 = 翻译/显示原文切换；hover 延迟出现次级按钮（P6 扩展）
 */

export interface FloatBallOptions {
  enabled: boolean;
  transparency: number; // 0-100
  hoverDelayMs: number;
  onClick: () => void;
}

export const FLOATBALL_HOST_CLASS = 'imt-rebuild-floatball-wrap';

export function mountFloatBall(opts: FloatBallOptions): HTMLElement | null {
  if (!opts.enabled) return null;
  if (document.querySelector(`.${FLOATBALL_HOST_CLASS}`)) return null; // 防重复

  const host = document.createElement('div');
  host.className = FLOATBALL_HOST_CLASS;

  const ball = document.createElement('div');
  ball.className = 'imt-rebuild-floatball';
  ball.title = '翻译 / 显示原文 (Alt+A)';
  ball.textContent = '译';
  ball.style.opacity = String(Math.max(0.15, 1 - opts.transparency / 100));
  ball.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    opts.onClick();
  });
  host.appendChild(ball);
  document.documentElement.appendChild(host);
  return host;
}

export function unmountFloatBall(): void {
  document.querySelectorAll(`.${FLOATBALL_HOST_CLASS}`).forEach((n) => n.remove());
}

/** 悬浮球状态类名后缀 */
export type FloatBallStatus = 'idle' | 'translating' | 'done' | 'error';

const STATUS_CLASSES: Record<FloatBallStatus, string> = {
  idle: '',
  translating: 'imt-rebuild-floatball-translating',
  done: 'imt-rebuild-floatball-done',
  error: 'imt-rebuild-floatball-error',
};

/** 悬浮球三态可视反馈：未翻译（默认）/ 翻译中（转圈）/ 完成（绿色）/ 失败（红色） */
export function setFloatBallStatus(status: FloatBallStatus): void {
  document.querySelectorAll('.imt-rebuild-floatball').forEach((n) => {
    n.classList.remove(
      'imt-rebuild-floatball-translating',
      'imt-rebuild-floatball-done',
      'imt-rebuild-floatball-error',
      'imt-rebuild-floatball-active', // 兼容旧类清理
    );
    const cls = STATUS_CLASSES[status];
    if (cls) n.classList.add(cls);
  });
}
