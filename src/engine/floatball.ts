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

export function setFloatBallState(active: boolean): void {
  document.querySelectorAll('.imt-rebuild-floatball').forEach((n) => {
    n.classList.toggle('imt-rebuild-floatball-active', active);
  });
}
