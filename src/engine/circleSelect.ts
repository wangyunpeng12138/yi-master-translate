import type { UserConfig } from '@/core/config/defaults';
import { showResultPanel, type PanelResult } from './panel';

/**
 * 圈选翻译（P6，截图 OCR）
 * 流程（对齐评审 3.3-3 时序）：按住圈选键拖拽画框 → 请求 background captureVisibleTab 截图
 *   → canvas 裁剪选区 → offscreen OCR → 翻译 → 弹窗
 * MV3 约束：captureVisibleTab 约 2 次/秒，加节流。
 */

let config: UserConfig | null = null;
let arming = false;
let overlay: HTMLDivElement | null = null;
let box: HTMLDivElement | null = null;
let startPoint: { x: number; y: number } | null = null;
let lastShotAt = 0;

export function initCircleSelect(c: UserConfig): void {
  config = c;
  if (!c.selection.circleSelectEnabled) return;
  document.addEventListener('keydown', onKeyDown, true);
  document.addEventListener('keyup', onKeyUp, true);
}

export function disposeCircleSelect(): void {
  document.removeEventListener('keydown', onKeyDown, true);
  document.removeEventListener('keyup', onKeyUp, true);
  destroyOverlay();
}

function onKeyDown(e: KeyboardEvent): void {
  const c = config;
  if (!c?.selection.circleSelectEnabled) return;
  if (e.key.toLowerCase() !== c.selection.circleSelectKey.toLowerCase()) return;
  if (isTypingContext(e.target)) return;
  if (arming) return;
  arming = true;
  e.preventDefault();
  startOverlay();
}

function onKeyUp(e: KeyboardEvent): void {
  const c = config;
  if (!c) return;
  if (e.key.toLowerCase() !== c.selection.circleSelectKey.toLowerCase()) return;
  arming = false;
  finishOverlay();
}

function isTypingContext(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || target.isContentEditable;
}

function startOverlay(): void {
  destroyOverlay();
  overlay = document.createElement('div');
  overlay.style.cssText =
    'position:fixed;inset:0;z-index:2147483645;cursor:crosshair;background:rgba(30,30,30,.08);';
  box = document.createElement('div');
  box.style.cssText =
    'position:absolute;border:2px dashed #ea4c89;background:rgba(234,76,137,.12);display:none;';
  overlay.append(box);
  overlay.addEventListener('mousedown', (e) => {
    e.preventDefault();
    startPoint = { x: e.clientX, y: e.clientY };
    if (box) {
      box.style.display = 'block';
      box.style.left = `${e.clientX}px`;
      box.style.top = `${e.clientY}px`;
      box.style.width = '0px';
      box.style.height = '0px';
    }
  });
  overlay.addEventListener('mousemove', (e) => {
    if (!startPoint || !box) return;
    const x = Math.min(startPoint.x, e.clientX);
    const y = Math.min(startPoint.y, e.clientY);
    box.style.left = `${x}px`;
    box.style.top = `${y}px`;
    box.style.width = `${Math.abs(e.clientX - startPoint.x)}px`;
    box.style.height = `${Math.abs(e.clientY - startPoint.y)}px`;
  });
  document.documentElement.appendChild(overlay);
}

function finishOverlay(): void {
  const rect = box?.getBoundingClientRect();
  destroyOverlay();
  if (!rect || rect.width < 10 || rect.height < 10) return;
  void runCircleTranslate(rect.left, rect.top, rect.width, rect.height);
}

function destroyOverlay(): void {
  overlay?.remove();
  overlay = null;
  box = null;
  startPoint = null;
}

async function runCircleTranslate(x: number, y: number, w: number, h: number): Promise<void> {
  const c = config;
  if (!c) return;
  // 节流（captureVisibleTab ≈ 2 次/秒）
  const wait = Math.max(0, 550 - (Date.now() - lastShotAt));
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastShotAt = Date.now();

  const promise = (async (): Promise<PanelResult> => {
    const shot = (await browser.runtime.sendMessage({
      type: 'capture:visible',
      payload: {},
    })) as { dataUrl?: string };
    if (!shot?.dataUrl) throw new Error('截图失败（captureVisibleTab 受限）');

    // 裁剪选区（devicePixelRatio 缩放）
    const dpr = window.devicePixelRatio || 1;
    const img = await loadImage(shot.dataUrl);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas 不可用');
    ctx.drawImage(img, x * dpr, y * dpr, w * dpr, h * dpr, 0, 0, canvas.width, canvas.height);
    const cropped = canvas.toDataURL('image/png');

    // offscreen OCR
    const ocr = (await browser.runtime.sendMessage({
      type: 'ocr:image',
      payload: { dataUrl: cropped },
    })) as { text?: string };
    const text = (ocr?.text ?? '').trim();
    if (!text) throw new Error('OCR 未识别到文字（检查 tesseract 资源与网络语言包）');

    // 翻译
    const translated = (await browser.runtime.sendMessage({
      type: 'translate:batch',
      payload: {
        texts: [text],
        from: 'auto',
        to: c.general.targetLanguage,
        service: c.general.service,
        scope: 'selection',
      },
    })) as { texts?: string[] };
    return { original: text, translated: translated?.texts?.[0] ?? '' };
  })();

  showResultPanel(x + w + 8, y, promise);
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('截图加载失败'));
    img.src = src;
  });
}
