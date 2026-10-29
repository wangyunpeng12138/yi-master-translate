import { browser } from 'wxt/browser';
import { loadUserConfig, onUserConfigChanged, saveUserConfig } from '@/core/config/storage';
import { TranslateCache } from '@/core/services/cache';
import { translateBatch } from '@/core/services/aiBatch';
import type { RequestMessage } from '@/core/messaging/protocol';

/**
 * 后台 Service Worker（P2：配置中心 + 翻译调度 + 命令分发）
 * - config:get / config:set → 三层合并配置读写；写入后广播 config:changed
 * - translate:batch → 缓存 + 限流 + 适配器调度
 * - commands（Alt+A/W/S/I…）→ 转发活动标签页
 */

const cache = new TranslateCache({
  get: async (keys) => {
    const stored = await browser.storage.local.get(keys as string[] | null);
    return stored as Record<string, string>;
  },
  set: async (entries) => {
    await browser.storage.local.set(entries);
  },
});

async function broadcastConfig(): Promise<void> {
  const config = await loadUserConfig();
  const tabs = await browser.tabs.query({});
  await Promise.allSettled(
    tabs.map((tab) =>
      tab.id ? browser.tabs.sendMessage(tab.id, { type: 'config:changed', payload: { config } }) : undefined,
    ),
  );
}

async function getActiveTab(): Promise<{ id?: number } | null> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  return tab ?? null;
}

export default defineBackground(() => {
  // 快捷键命令 → 内容脚本
  browser.commands?.onCommand.addListener(async (command: string) => {
    const tab = await getActiveTab();
    if (!tab?.id) return;
    try {
      await browser.tabs.sendMessage(tab.id, { type: 'command', payload: { command } });
    } catch {
      // 无内容脚本的页面（chrome:// 等）静默
    }
  });

  // 请求-响应消息处理
  browser.runtime.onMessage.addListener((raw: unknown) => {
    const msg = raw as RequestMessage<keyof import('@/core/messaging/protocol').RequestMap>;
    if (!msg || typeof msg.type !== 'string') return;

    switch (msg.type) {
      case 'config:get':
        return loadUserConfig();
      case 'config:set':
        return (async () => {
          await saveUserConfig((msg as { payload?: unknown }).payload as never);
          await broadcastConfig();
          return { ok: true as const };
        })();
      case 'translate:batch':
        return translateBatch({ cache, loadConfig: loadUserConfig }, (msg as { payload: never }).payload);
      case 'cache:query': {
        return (async () => {
          const keys = ((msg as { payload?: { keys?: string[] } }).payload?.keys ?? []) as string[];
          const hits = await cache.query(keys);
          return { hits };
        })();
      }
      case 'offscreen:ping':
        return { type: 'offscreen:pong' as const };
      default:
        return;
    }
  });

  // 内容引擎状态事件 → badge（译中 … / 完成 ✓ / 失败 × / 空闲清除）
  browser.runtime.onMessage.addListener((msg: { type?: string; payload?: { state?: string } }) => {
    if (msg?.type !== 'translation:status') return;
    const state = msg.payload?.state;
    const badge = state === 'translating' ? '…' : state === 'done' ? '✓' : state === 'error' ? '×' : '';
    void browser.action.setBadgeText({ text: badge });
    void browser.action.setBadgeBackgroundColor({
      color: state === 'error' ? '#f56c6c' : state === 'done' ? '#1e9e6a' : '#888888',
    });
  });

  // UI 直接写 storage 的场景（多窗口）：广播给内容脚本
  onUserConfigChanged(() => {
    void broadcastConfig();
  });

  browser.runtime.onInstalled.addListener((details) => {
    console.log(`[imt-rebuild] ${details.reason}, version=${browser.runtime.getManifest().version}`);
  });

  if (import.meta.env.DEV) {
    console.log('[imt-rebuild] background ready (P2)');
  }
});
