/**
 * Offscreen Document：本地 OCR（tesseract.js 5.1.1，资源复用原版打包文件）
 * - worker/core 走扩展内 public/tesseract/*（离线可用）
 * - 语言包走官方 CDN（首次下载后浏览器缓存）
 * 消息协议：{ type: 'ocr:image', payload: { dataUrl } } → { text }
 */
import Tesseract from 'tesseract.js';

let worker: Awaited<ReturnType<typeof Tesseract.createWorker>> | null = null;

async function getWorker() {
  if (!worker) {
    worker = await Tesseract.createWorker('eng', 1, {
      // public/ 下的静态资源（复用原版打包文件），路径不在 WXT 生成的 PublicPath 类型中，需显式放宽
      workerPath: browser.runtime.getURL('tesseract/worker.min.js' as never),
      corePath: browser.runtime.getURL('tesseract/tesseract-core-simd-lstm.wasm.js' as never),
      langPath: 'https://tessdata.projectnaptha.com/4.0.0',
      logger: () => undefined,
    });
  }
  return worker;
}

browser.runtime.onMessage.addListener((msg: { type?: string; payload?: { dataUrl?: string } }) => {
  if (msg?.type === 'offscreen:ping') {
    return Promise.resolve({ type: 'offscreen:pong' });
  }
  if (msg?.type !== 'ocr:image') return;

  return (async () => {
    const dataUrl = msg.payload?.dataUrl;
    if (!dataUrl) throw new Error('ocr:image 缺少 dataUrl');
    const w = await getWorker();
    const result = await w.recognize(dataUrl);
    return { text: result.data.text ?? '' };
  })();
});

console.log('[imt-rebuild] offscreen OCR ready');
