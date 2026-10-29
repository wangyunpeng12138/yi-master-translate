import type { UserConfig } from '@/core/config/defaults';
import { showResultPanel, type PanelResult } from './panel';

/**
 * 图片翻译（右键菜单「翻译图片」→ 本地 OCR → 翻译 → 弹窗）
 * 跨域取图由 background（host 权限）代为 fetch；OCR 由 offscreen tesseract 执行。
 */

export async function translateImage(srcUrl: string, x: number, y: number, config: UserConfig): Promise<void> {
  const promise = (async (): Promise<PanelResult> => {
    // 1. background 取图（跨域）或同源直接 fetch
    let dataUrl: string | undefined;
    try {
      const res = (await browser.runtime.sendMessage({
        type: 'image:fetch',
        payload: { url: srcUrl },
      })) as { dataUrl?: string };
      dataUrl = res?.dataUrl;
    } catch {
      // 回退：尝试页面内 canvas 取图（同源图片）
      dataUrl = await drawToDataUrl(srcUrl);
    }
    if (!dataUrl) throw new Error('无法获取图片（跨域限制）');

    // 2. 确保 offscreen 存活并 OCR
    await browser.runtime.sendMessage({ type: 'offscreen:ensure', payload: {} });
    const ocr = (await browser.runtime.sendMessage({
      type: 'ocr:image',
      payload: { dataUrl },
    })) as { text?: string };
    const text = (ocr?.text ?? '').trim();
    if (!text) throw new Error('OCR 未识别到文字');

    // 3. 翻译
    const translated = (await browser.runtime.sendMessage({
      type: 'translate:batch',
      payload: {
        texts: [text],
        from: 'auto',
        to: config.general.targetLanguage,
        service: config.general.service,
        scope: 'selection',
      },
    })) as { texts?: string[] };
    return { original: text, translated: translated?.texts?.[0] ?? '' };
  })();

  showResultPanel(x, y, promise);
}

function drawToDataUrl(srcUrl: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) return resolve(undefined);
        ctx.drawImage(img, 0, 0);
        resolve(canvas.toDataURL('image/png'));
      } catch {
        resolve(undefined); // CORS 污染画布
      }
    };
    img.onerror = () => resolve(undefined);
    img.src = srcUrl;
  });
}
