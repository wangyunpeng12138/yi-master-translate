/**
 * 划词/悬停/圈选 共享弹窗（fixed 层，closed Shadow DOM 隔离，防站点 CSS 污染）
 */

export interface PanelResult {
  original: string;
  translated: string;
}

let host: HTMLDivElement | null = null;
let shadow: ShadowRoot | null = null;

function ensureShadow(): void {
  if (host) return;
  host = document.createElement('div');
  host.className = 'imt-rebuild-panel-host';
  host.style.cssText = 'all:initial;position:fixed;z-index:2147483647;';
  shadow = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = `
    .wrap { position: fixed; max-width: 380px; background: #fff; color: #303133;
      border: 1px solid #dcdfe6; border-radius: 10px; box-shadow: 0 4px 16px rgba(0,0,0,.18);
      font: 13px/1.7 -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif; overflow: hidden; }
    .head { display: flex; justify-content: space-between; align-items: center;
      padding: 8px 12px; background: #f5f7fa; border-bottom: 1px solid #ebeef5; font-size: 12px; color: #909399; }
    .head button { border: 0; background: none; cursor: pointer; font-size: 12px; color: #409eff; }
    .body { padding: 10px 14px; }
    .orig { color: #909399; font-size: 12px; margin-bottom: 6px; max-height: 90px; overflow: auto; }
    .trans { font-size: 14px; white-space: pre-wrap; }
    .trans.loading { color: #909399; }
    .err { color: #f56c6c; }
  `;
  shadow.appendChild(style);
  document.documentElement.appendChild(host);
}

export function showResultPanel(
  x: number,
  y: number,
  result: Promise<PanelResult>,
): void {
  ensureShadow();
  if (!shadow) return;
  shadow.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'wrap';
  const head = document.createElement('div');
  head.className = 'head';
  const title = document.createElement('span');
  title.textContent = '沉浸式翻译（复刻版）';
  const close = document.createElement('button');
  close.textContent = '关闭';
  close.onclick = () => destroyPanel();
  head.append(title, close);
  const body = document.createElement('div');
  body.className = 'body';
  const orig = document.createElement('div');
  orig.className = 'orig';
  const trans = document.createElement('div');
  trans.className = 'trans loading';
  trans.textContent = '翻译中…';
  body.append(orig, trans);
  wrap.append(head, body);

  // 定位（防溢出）
  const place = () => {
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    const w = wrap.offsetWidth || 360;
    const h = wrap.offsetHeight || 120;
    const left = Math.min(Math.max(8, x), vw - w - 8);
    const top = Math.min(Math.max(8, y), vh - h - 8);
    wrap.style.left = `${left}px`;
    wrap.style.top = `${top}px`;
  };
  // 先离屏测量再定位
  wrap.style.left = '-9999px';
  wrap.style.top = '0px';
  shadow.appendChild(wrap);
  requestAnimationFrame(place);

  result
    .then((r) => {
      orig.textContent = r.original;
      trans.classList.remove('loading');
      trans.textContent = r.translated;
      place();
    })
    .catch((e) => {
      trans.classList.remove('loading');
      trans.classList.add('err');
      trans.textContent = `翻译失败：${e instanceof Error ? e.message : String(e)}`;
    });
}

export function destroyPanel(): void {
  host?.remove();
  host = null;
  shadow = null;
}
