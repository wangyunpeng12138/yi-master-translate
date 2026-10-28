import { browser } from 'wxt/browser';

/**
 * 后台 Service Worker（P0 骨架）
 * P0 职责：命令分发（Alt+A/W/S/I 等）→ 转发给当前活动标签页的内容脚本。
 * P2 起：ConfigCenter、TranslateScheduler、右键菜单、badge、DNR 规则装载逐步在此扩展。
 */

async function getActiveTab(): Promise<{ id?: number } | null> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  return tab ?? null;
}

export default defineBackground(() => {
  // 浏览器级快捷键命令 → 内容脚本消息（P0 打通链路）
  browser.commands?.onCommand.addListener(async (command: string) => {
    const tab = await getActiveTab();
    if (!tab?.id) return;
    try {
      await browser.tabs.sendMessage(tab.id, { type: 'command', command });
      if (import.meta.env.DEV) console.log(`[imt-rebuild] command -> tab ${tab.id}: ${command}`);
    } catch {
      // 页面无内容脚本（如 chrome:// 页）时静默
    }
  });

  browser.runtime.onInstalled.addListener((details) => {
    console.log(`[imt-rebuild] ${details.reason}, version=${browser.runtime.getManifest().version}`);
  });

  if (import.meta.env.DEV) {
    console.log('[imt-rebuild] background ready');
  }
});
