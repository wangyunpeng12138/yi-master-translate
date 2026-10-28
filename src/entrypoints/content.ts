import { browser } from 'wxt/browser';

/**
 * 内容脚本守卫（对齐原版 content_guard.js 的设计意图）
 * - document_start + all_frames 全量注入，保持极轻；
 * - P3 起在确认需要翻译引擎时动态注入 engine 模块（原版为 4.3MB content_main.js）。
 * P0：仅监听后台命令消息并打日志，验证链路。
 */

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_start',
  allFrames: true,
  main() {
    browser.runtime.onMessage.addListener((msg: { type?: string; command?: string }) => {
      if (msg?.type === 'command' && msg.command) {
        console.log(`[imt-rebuild] content received command: ${msg.command} @ ${location.href}`);
      }
      if (msg?.type === 'config:changed') {
        // P3 起翻译引擎将在此热更新配置；P1 仅验证链路
        console.log('[imt-rebuild] content received config:changed');
      }
    });
    if (import.meta.env.DEV) {
      console.log('[imt-rebuild] guard ready @', location.host);
    }
  },
});
