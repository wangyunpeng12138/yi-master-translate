import { browser } from 'wxt/browser';
import { loadUserConfig, onUserConfigChanged, saveUserConfig } from '@/core/config/storage';
import type { DeepPartial } from '@/core/config/merge';
import type { UserConfig } from '@/core/config/defaults';
import { TranslateCache } from '@/core/services/cache';
import { translateBatch } from '@/core/services/aiBatch';
import { getAdapter } from '@/core/services/registry';
import { applyProxySettings, applyLocalServiceDnr } from '@/core/services/proxy';
import { buildExplainExport, clearExplainCache, explainParagraph } from '@/core/services/explain';
import { searchSelection } from '@/core/services/selectionSearch';
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

/** storage.local 直接作为 CacheArea（explain 缓存读写/导出/清除共用） */
const storageArea = {
  get: async (keys?: string[] | null) => {
    const stored = await browser.storage.local.get(keys as string[] | null);
    return stored as Record<string, string>;
  },
  set: async (entries: Record<string, string>) => {
    await browser.storage.local.set(entries);
  },
  remove: async (keys: string[]) => {
    await browser.storage.local.remove(keys);
  },
};

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

/* ---------- 翻译状态展示：badge 跟随当前活动标签页（页面为权威源，直查不落存） ---------- */
type TabStatus = 'idle' | 'translating' | 'done' | 'error';

const BADGE: Record<TabStatus, { text: string; color: string }> = {
  idle: { text: '', color: '#888888' },
  translating: { text: '…', color: '#888888' },
  done: { text: '✓', color: '#1e9e6a' },
  error: { text: '×', color: '#f56c6c' },
};

async function applyBadge(status: TabStatus): Promise<void> {
  const badge = BADGE[status] ?? BADGE.idle;
  await browser.action.setBadgeText({ text: badge.text });
  if (badge.text) {
    await browser.action.setBadgeBackgroundColor({ color: badge.color });
  }
}

/** 向活动标签页查询真实翻译状态并刷新 badge（切 tab 自动同步；无内容脚本的页面清空） */
async function refreshBadge(): Promise<void> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (tab?.id == null) return;
  try {
    const r = (await browser.tabs.sendMessage(tab.id, { type: 'status:query' })) as { state?: TabStatus };
    await applyBadge(r?.state ?? 'idle');
  } catch {
    await applyBadge('idle');
  }
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
  browser.runtime.onMessage.addListener((raw: unknown, sender: { tab?: { id?: number } }) => {
    const msg = raw as { type?: string; payload?: unknown };
    if (!msg || typeof msg.type !== 'string') return;

    switch (msg.type) {
      case 'config:get':
        return loadUserConfig();
      case 'config:set':
        return (async () => {
          // 协议是 { patch }（见 protocol.ts）。此前把整个 payload 传进 saveUserConfig，
          // 会往配置里塞一个假的 `patch` 键、真实设置不生效（2026-11-09 实测发现）。
          const payload = msg.payload as { patch?: DeepPartial<UserConfig> } | undefined;
          const patch = payload && 'patch' in payload ? payload.patch : (payload as DeepPartial<UserConfig> | undefined);
          await saveUserConfig(patch ?? {});
          await broadcastConfig();
          return { ok: true as const };
        })();
      case 'translate:batch':
        // 协议约定返回 TranslateResult = { texts: string[] }（P2 遗留 bug 修复：此前返回裸数组）
        return (async () => {
          const req = msg.payload as TranslateRequest;
          const texts = await translateBatch(
            {
              cache,
              loadConfig: loadUserConfig,
              // 发起页面世代检查：页面导航/关闭后旧实例销毁，取消其排队批次（释放共享限流队列）。
              // 同 tab 导航后新实例仍会应答 tab:check，但 epoch 不同 → 旧批次取消；
              // 单次探测失败重试一次，防御消息总线偶发抖动误杀活页面
              isAlive:
                sender?.tab?.id && req?.epoch
                  ? async () => {
                      const probe = async () => {
                        try {
                          const r = (await browser.tabs.sendMessage(sender.tab!.id!, {
                            type: 'tab:check',
                            payload: { epoch: req.epoch },
                          })) as { ok?: boolean };
                          return r?.ok === true;
                        } catch {
                          return false;
                        }
                      };
                      return (await probe()) || (await probe());
                    }
                  : undefined,
            },
            req,
          );
          return { texts };
        })();
      case 'explain:paragraph': {
        // 段落术语解释（AI 搜索）：缓存命中直接返回，否则调 AI 并写缓存
        return (async () => {
          const text = (msg.payload as { text?: string })?.text;
          if (!text) throw new Error('explain:paragraph 缺少 text');
          const result = await explainParagraph({ loadConfig: loadUserConfig, area: storageArea }, text);
          return result;
        })();
      }
      case 'explain:export': {
        // 导出全部术语解释为 txt 文本
        return (async () => {
          const { text, count } = await buildExplainExport(storageArea);
          return { text, count };
        })();
      }
      case 'explain:clear': {
        return (async () => {
          const removed = await clearExplainCache(storageArea);
          return { removed };
        })();
      }
      case 'selection:search': {
        // 划词 AI 搜索：选中文字的中文解释（缓存命中直接返回，否则调 AI 并写缓存）
        return (async () => {
          const text = (msg.payload as { text?: string })?.text;
          if (!text) throw new Error('selection:search 缺少 text');
          return searchSelection({ loadConfig: loadUserConfig, area: storageArea }, text);
        })();
      }
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

  // 内容引擎状态事件 → 仅当来自当前活动标签页时刷新 badge（页面直查为准，不落存防 SW 生命周期丢失）。
  // 注意：此处必须是普通函数——async 监听器对任何消息都会立即 resolve(Promise<undefined>)，
  // 在 Chromium 多监听器竞争中抢答真正的请求处理监听器（switch），导致 config:get 等全部返回 null
  browser.runtime.onMessage.addListener(
    (
      msg: { type?: string; payload?: { state?: TabStatus } },
      sender: { tab?: { id?: number } },
    ) => {
      if (msg?.type !== 'translation:status') return; // undefined：不干扰其他监听器响应
      const state = msg.payload?.state;
      const senderTabId = sender?.tab?.id;
      if (!state || senderTabId == null) return;
      void (async () => {
        try {
          const [active] = await browser.tabs.query({ active: true, currentWindow: true });
          if (active?.id === senderTabId) await applyBadge(state);
        } catch {
          // badge 刷新失败静默
        }
      })();
    },
  );
  // 切换标签页 → badge 跟随新页真实状态
  browser.tabs.onActivated.addListener(() => {
    void refreshBadge();
  });
  // SW 冷启动 → 立即对齐活动页状态
  void refreshBadge();

  // UI 直接写 storage 的场景（多窗口）：广播给内容脚本
  onUserConfigChanged(() => {
    void broadcastConfig();
  });

  // 网络代理 + 本地服务 CORS 兼容：SW 启动同步一次 + 配置变化时重新应用
  // （代理为浏览器级持久设置；DNR session 规则随浏览器重启消失，每次启动重建）
  void loadUserConfig().then((c) => {
    void applyProxySettings(c);
    void applyLocalServiceDnr(c);
  });
  onUserConfigChanged(() => {
    void loadUserConfig().then((c) => {
      void applyProxySettings(c);
      void applyLocalServiceDnr(c);
    });
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
