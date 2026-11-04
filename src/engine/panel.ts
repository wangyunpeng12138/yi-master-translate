/**
 * 划词/悬停/圈选 共享弹窗（fixed 层，closed Shadow DOM 隔离，防站点 CSS 污染）
 */

export interface PanelResult {
  original: string;
  translated: string;
}

let host: HTMLDivElement | null = null;
let shadow: ShadowRoot | null = null;

function ensureShadow(): ShadowRoot | null {
  if (host && shadow) return shadow;
  host = document.createElement('div');
  host.className = 'imt-rebuild-panel-host';
  // left/top 显式 0：避免 fixed 元素以文档流静态位置停靠产生大块透明选区
  //（此前实测 host 停靠在页面底部 1021×189，即使内容不可见也会拦截页面底部点击）
  host.style.cssText = 'all:initial;position:fixed;left:0;top:0;z-index:2147483647;';
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
    /* 翻译中：圆环 spinner + 文案（大模型逐段推理较慢，必须有明确进度反馈） */
    .trans.loading { color: #909399; display: flex; align-items: center; gap: 6px; }
    .trans.loading::before { content: ''; flex: none; width: 12px; height: 12px;
      box-sizing: border-box; border: 2px solid rgba(84,112,198,.25); border-top-color: #5470c6;
      border-radius: 50%; animation: imt-panel-spin .8s linear infinite; }
    @keyframes imt-panel-spin { to { transform: rotate(360deg); } }
    .err { color: #f56c6c; }
  `;
  shadow.appendChild(style);
  document.documentElement.appendChild(host);
  return shadow;
}

export function showResultPanel(
  x: number,
  y: number,
  result: Promise<PanelResult>,
): void {
  const sr = ensureShadow();
  if (!sr) return;
  // 关键：只移除旧面板，不能 shadow.innerHTML=''——那会把 <style> 一起清掉，
  // wrap 失去 position:fixed 等全部样式，沉到页面底部不可见（“划词无弹窗”根因）
  sr.querySelectorAll('.wrap').forEach((n) => n.remove());
  const wrap = document.createElement('div');
  wrap.className = 'wrap';
  const head = document.createElement('div');
  head.className = 'head';
  const title = document.createElement('span');
  title.textContent = '译大师';
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
  sr.appendChild(wrap);
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
