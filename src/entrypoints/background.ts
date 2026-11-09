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
import {
  AsrError,
  audioFingerprint,
  asrCacheKey,
  base64ToArrayBuffer,
  clearAsrCache,
  createAsrProvider,
  encodeWav,
  getAsrCache,
  getAsrChain,
  isLocalAsrProvider,
  setAsrCache,
} from '@/core/asr';
import type { AsrProviderId } from '@/core/asr';

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

/** ASR 缓存区（值是 cue 对象而非字符串，单独一份以免污染 explain 的 string 契约） */
const asrStorageArea = {
  get: async (keys: string[] | null) => {
    const stored = await browser.storage.local.get(keys as string[] | null);
    return stored as Record<string, unknown>;
  },
  set: async (entries: Record<string, unknown>) => {
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

/**
 * 确保 offscreen 文档存活（OCR / 本地 Whisper 前调用）
 * - `reasons` 必须是 Chrome 的合法枚举（此前用 'OCR' 非法 → createDocument 一直失败，
 *   offscreen 从未真正创建过，所有转发消息都报 "Receiving end does not exist"）
 * - 已存在时 createDocument 会抛错，静默忽略
 */
async function ensureOffscreen(): Promise<void> {
  const has = await browser.runtime.getContexts?.({ contextTypes: ['OFFSCREEN_DOCUMENT' as never] });
  if (Array.isArray(has) && has.length > 0) return;
  try {
    await browser.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['DOM_SCRAPING' as never, 'WORKERS' as never],
      justification: '本地 OCR 与本地 Whisper 语音识别（wasm 推理，需页面环境）',
    });
  } catch {
    // 已存在（"Only a single offscreen document may be created"）→ 忽略
  }
}

/**
 * 向 offscreen 发消息。
 * offscreen 刚创建时脚本可能还没就绪，直接发会 "Receiving end does not exist"（实测踩过），
 * 因此带小步重试。
 */
async function sendToOffscreen<T>(type: string, payload: unknown, retries = 6): Promise<T | undefined> {
  for (let i = 0; i < retries; i++) {
    await ensureOffscreen();
    try {
      return (await browser.runtime.sendMessage({ type, payload })) as T;
    } catch {
      await new Promise((r) => setTimeout(r, 150 + i * 150));
    }
  }
  return undefined;
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
      /* ---------- ASR：无字幕视频语音识别（方案见 docs/ASR字幕接入方案.md） ---------- */
      case 'asr:transcribe': {
        return (async () => {
          const payload = msg.payload as {
            wavBase64?: string;
            offsetSec?: number;
            durationSec?: number;
            language?: string;
          };
          if (!payload?.wavBase64) {
            return { ok: false as const, code: 'bad-request', message: 'asr:transcribe 缺少音频数据' };
          }
          const cfg = await loadUserConfig();
          if (!cfg.asr.enabled) {
            return { ok: false as const, code: 'disabled', message: 'ASR 未启用（设置页 → 视频字幕）' };
          }
          const chain = getAsrChain(cfg);
          if (chain.length === 0) {
            return { ok: false as const, code: 'no-provider', message: '未配置可用的 ASR 服务' };
          }
          const wav = base64ToArrayBuffer(payload.wavBase64);
          const lang = payload.language || cfg.asr.cloud.language || 'auto';
          const offsetSec = Number(payload.offsetSec ?? 0);
          const durationSec = Number(payload.durationSec ?? 0);
          const fingerprint = audioFingerprint(wav);

          // 链里有本地 provider 时先把 offscreen 拉起来（推理在那边跑）
          if (chain.some((id) => isLocalAsrProvider(id))) {
            await ensureOffscreen().catch(() => undefined);
          }

          let lastError: Error | null = null;
          for (const id of chain) {
            const key = asrCacheKey(id, lang, fingerprint);
            if (cfg.asr.cache.enabled) {
              const hit = await getAsrCache(asrStorageArea, key, cfg.asr.cache.ttlDays).catch(() => null);
              // 缓存存的是**相对音频起点**的 cue，这里再叠加窗口偏移
              if (hit?.cues?.length) {
                return {
                  ok: true as const,
                  provider: id,
                  cached: true,
                  cues: hit.cues.map((c) => ({ ...c, start: c.start + offsetSec, end: c.end + offsetSec })),
                };
              }
            }
            try {
              const provider = createAsrProvider(cfg, id);
              const cues = await provider.transcribe({ wav, offsetSec, durationSec, language: lang });
              if (cfg.asr.cache.enabled && cues.length > 0) {
                await setAsrCache(asrStorageArea, key, {
                  cues, // 相对时间轴
                  createdAt: Date.now(),
                  provider: id,
                  lang,
                }).catch(() => undefined);
              }
              return {
                ok: true as const,
                provider: id,
                cached: false,
                cues: cues.map((c) => ({ ...c, start: c.start + offsetSec, end: c.end + offsetSec })),
              };
            } catch (e) {
              lastError = e as Error;
              if ((e as AsrError)?.code === 'aborted') {
                return { ok: false as const, code: 'aborted', message: (e as Error).message };
              }
              console.warn(`[imt-rebuild] ASR provider ${id} 失败，尝试下一个：`, (e as Error).message);
            }
          }
          const err = lastError as AsrError | null;
          return { ok: false as const, code: err?.code ?? 'unknown', message: err?.message ?? 'ASR 全部失败' };
        })();
      }
      case 'asr:test': {
        // 自检：0.3s 静音 WAV 打一次真实请求，只验证「通不通」
        return (async () => {
          const cfg = await loadUserConfig();
          const wanted = (msg.payload as { provider?: string } | undefined)?.provider ?? 'auto';
          const chain =
            wanted === 'auto'
              ? getAsrChain({ ...cfg, asr: { ...cfg.asr, enabled: true } })
              : [wanted as AsrProviderId];
          if (chain.length === 0) {
            return { ok: false as const, code: 'no-provider', message: '未配置可用的 ASR 服务' };
          }
          const id = chain[0];
          const started = Date.now();
          try {
            const provider = createAsrProvider(cfg, id);
            const cues = await provider.transcribe({
              wav: encodeWav(new Float32Array(16_000 * 0.3)),
              offsetSec: 0,
              durationSec: 0.3,
              language: cfg.asr.cloud.language || 'auto',
            });
            return { ok: true as const, provider: id, ms: Date.now() - started, cueCount: cues.length };
          } catch (e) {
            return {
              ok: false as const,
              code: (e as AsrError)?.code ?? 'unknown',
              message: (e as Error).message,
            };
          }
        })();
      }
      case 'asr:cache:clear': {
        return (async () => ({ removed: await clearAsrCache(asrStorageArea) }))();
      }
      case 'openOptions': {
        // 播放器快捷面板里的「字幕样式 / 更多功能」跳设置页
        return (async () => {
          const hash = (msg.payload as { hash?: string } | undefined)?.hash;
          // getURL 的路径类型由 WXT 生成（未收录带 hash 的动态串），显式放宽
          const url = browser.runtime.getURL(`options.html${hash ? `#/${hash}` : ''}` as never);
          await browser.tabs.create({ url });
          return { ok: true as const };
        })();
      }
      case 'asr:model': {
        // 本地模型管理：转发给 offscreen（下载/删除/状态都在那边执行）
        return (async () => {
          const payload = msg.payload as { action?: 'status' | 'download' | 'remove'; model?: string };
          const cfg = await loadUserConfig();
          const model = payload?.model ?? cfg.asr.local.model;
          if (payload?.action === 'download') {
            const res = await sendToOffscreen<{ status?: string }>('asr:local:model', {
              action: 'download',
              model,
              dtype: cfg.asr.local.dtype,
              modelBaseUrl: cfg.asr.local.modelBaseUrl,
              modelRevision: cfg.asr.local.modelRevision,
            });            if (!res) {
              return { status: 'error' as const, error: '本地识别引擎未就绪（offscreen 创建失败）' };
            }
            return { status: 'downloading' as const, ratio: 0 };
          }
          if (payload?.action === 'remove') {
            const res = await sendToOffscreen<{ status?: string }>(
              'asr:local:model',
              { action: 'remove', model },
              3,
            );
            return { status: (res?.status as 'absent') ?? 'absent' };
          }
          // status：offscreen 未起时直接判 absent（不要为查状态就把引擎拉起来）
          const res = await sendToOffscreen<{
            status: 'absent' | 'downloading' | 'ready' | 'error';
            ratio?: number;
            error?: string;
          }>('asr:local:model', {
            action: 'status',
            model,
            dtype: cfg.asr.local.dtype,
            modelBaseUrl: cfg.asr.local.modelBaseUrl,
            modelRevision: cfg.asr.local.modelRevision,
          }, 2);
          return res ?? { status: 'absent' as const };
        })();
      }
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
