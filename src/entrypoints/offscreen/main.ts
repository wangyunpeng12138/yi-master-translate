/**
 * Offscreen Document（P0 骨架）
 * 用途（对齐原版 offscreen.html）：承载无法在 SW 中执行的页面级能力——
 * P8 阶段接入 tesseract.js OCR（本地图片文字识别）。
 * P0：仅回显就绪消息。
 */
console.log('[imt-rebuild] offscreen document ready');

browser.runtime.onMessage.addListener((msg: { type?: string }) => {
  if (msg?.type === 'offscreen:ping') {
    return Promise.resolve({ type: 'offscreen:pong' });
  }
});
