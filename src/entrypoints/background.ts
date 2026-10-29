import { browser } from 'wxt/browser';
import { loadUserConfig, onUserConfigChanged, saveUserConfig } from '@/core/config/storage';
import type { DeepPartial } from '@/core/config/merge';
import type { UserConfig } from '@/core/config/defaults';
import { TranslateCache } from '@/core/services/cache';
import { translateBatch } from '@/core/services/aiBatch';
import { getAdapter } from '@/core/services/registry';
import type { TranslateRequest } from '@/core/shared/types';

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

/** 右键菜单注册（对齐原版 4 项基础菜单 ID） */
async function setupContextMenus(): Promise<void> {
  const config = await loadUserConfig();
  await browser.contextMenus.removeAll();
  if (!config.contextMenu.enabled) return;
  browser.contextMenus.create({
    id: 'toggleTranslatePage',
    title: '翻译网页 / 显示原文',
    contexts: ['page', 'frame', 'selection'],
  });
  browser.contextMenus.create({
    id: 'openOptionsPage',
    title: '打开设置页',
    contexts: ['page', 'selection', 'image'],
  });
  browser.contextMenus.create({
    id: 'translateMangaMenuId',
    title: '翻译图片（本地 OCR）',
    contexts: ['image'],
  });
}

/** 确保 offscreen 文档存活（OCR 前调用）；已存在时 createDocument 抛错，静默忽略 */
async function ensureOffscreen(): Promise<void> {
  try {
    await browser.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['OCR' as never],
      justification: '本地 OCR 图片文字识别',
    });
  } catch {
    // 已存在（"Only a single offscreen document may be created"）→ 忽略
  }
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('read blob failed'));
    reader.readAsDataURL(blob);
  });
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
    const msg = raw as { type?: string; payload?: unknown };
    if (!msg || typeof msg.type !== 'string') return;

    switch (msg.type) {
      case 'config:get':
        return loadUserConfig();
      case 'config:set':
        return (async () => {
          await saveUserConfig(msg.payload as DeepPartial<UserConfig>);
          await broadcastConfig();
          return { ok: true as const };
        })();
      case 'translate:batch':
        return translateBatch(
          { cache, loadConfig: loadUserConfig },
          msg.payload as TranslateRequest,
        );
      case 'cache:query': {
        return (async () => {
          const keys = ((msg.payload as { keys?: string[] })?.keys ?? []) as string[];
          const hits = await cache.query(keys);
          return { hits };
        })();
      }
      case 'offscreen:ping':
        return { type: 'offscreen:pong' as const };
      case 'offscreen:ensure':
        // content/UI 在调用 OCR 前确保 offscreen 文档存活
        return (async () => {
          await ensureOffscreen();
          return { ok: true as const };
        })();
      case 'ai:write':
        // AI Write 面板（P8c）：自定义 AI 服务驱动的润色/翻译写作
        return (async () => {
          const payload = msg.payload as { text?: string; mode?: 'polish' | 'translate'; to?: string };
          const text = payload?.text;
          if (!text) throw new Error('ai:write 缺少 text');
          const config = await loadUserConfig();
          const serviceId = config.customServices[0]?.id;
          if (!serviceId) throw new Error('请先在「翻译服务」添加自定义 AI 服务');
          const adapter = getAdapter(config, serviceId);
          const out = await adapter.translate([text], 'auto', payload?.to || config.general.targetLanguage, {
            expertPrompt:
              payload?.mode === 'polish'
                ? 'Polish the user text: improve clarity, grammar and expression while strictly keeping the original language and meaning. Return ONLY the polished text.'
                : undefined,
          });
          return { text: out[0] ?? '' };
        })();
      case 'capture:visible':
        // 圈选截图（MV3：SW 可调 captureVisibleTab，限约 2 次/秒）
        return (async () => {
          const dataUrl = await browser.tabs.captureVisibleTab({ format: 'png' });
          return { dataUrl };
        })();
      case 'image:fetch':
        // 图片翻译取图：SW 带 host 权限可跨域 fetch，content 不能
        return (async () => {
          const url = (msg.payload as { url?: string })?.url;
          if (!url) throw new Error('image:fetch 缺少 url');
          const res = await fetch(url);
          if (!res.ok) throw new Error(`fetch image HTTP ${res.status}`);
          const blob = await res.blob();
          const dataUrl = await blobToDataUrl(blob);
          return { dataUrl };
        })();
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

  // 右键菜单（P6：对齐原版 4 项基础菜单）
  setupContextMenus();
  onUserConfigChanged(() => {
    void setupContextMenus();
  });
  browser.contextMenus.onClicked.addListener(async (info, tab) => {
    const tabId = tab?.id;
    if (!tabId) return;
    if (info.menuItemId === 'toggleTranslatePage') {
      await browser.tabs.sendMessage(tabId, { type: 'command', payload: { command: 'toggleTranslatePage' } }).catch(() => undefined);
    } else if (info.menuItemId === 'openOptionsPage') {
      await browser.runtime.openOptionsPage();
    } else if (info.menuItemId === 'translateMangaMenuId') {
      await ensureOffscreen();
      await browser.tabs
        .sendMessage(tabId, { type: 'translateImage', payload: { srcUrl: info.srcUrl, x: 100, y: 100 } })
        .catch(() => undefined);
    }
  });

  browser.runtime.onInstalled.addListener((details) => {
    console.log(`[imt-rebuild] ${details.reason}, version=${browser.runtime.getManifest().version}`);
  });

  if (import.meta.env.DEV) {
    console.log('[imt-rebuild] background ready (P2)');
  }
});
