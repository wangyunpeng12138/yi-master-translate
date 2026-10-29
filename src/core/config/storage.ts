import { browser } from 'wxt/browser';
import { DEFAULT_CONFIG, type UserConfig } from './defaults';
import { deepMerge, type DeepPartial } from './merge';

/**
 * 存储封装（三层合并的第 3 层：用户配置）
 * - sync: userConfig（跟随账号，体积小）
 * - local: 翻译缓存 / 术语库等大对象（P2/P6 扩展）
 */

const SYNC_KEY = 'userConfig';

export async function loadUserConfig(): Promise<UserConfig> {
  const stored = await browser.storage.sync.get(SYNC_KEY);
  const patch = (stored as Record<string, unknown>)[SYNC_KEY];
  return deepMerge(DEFAULT_CONFIG, patch);
}

export async function saveUserConfig(patch: DeepPartial<UserConfig> | UserConfig): Promise<UserConfig> {
  const next = deepMerge(await loadUserConfig(), patch);
  await browser.storage.sync.set({ [SYNC_KEY]: next });
  return next;
}

export async function resetUserConfig(): Promise<void> {
  await browser.storage.sync.remove(SYNC_KEY);
}

export function onUserConfigChanged(cb: (config: UserConfig) => void): () => void {
  const listener = (changes: Record<string, { newValue?: unknown }>, area: string) => {
    if (area === 'sync' && SYNC_KEY in changes) {
      cb(deepMerge(DEFAULT_CONFIG, changes[SYNC_KEY]?.newValue));
    }
  };
  browser.storage.onChanged.addListener(listener);
  return () => browser.storage.onChanged.removeListener(listener);
}

/** 站点级设置（popup「当前网站翻译设置」） */
export async function getSiteConfig(host: string): Promise<UserConfig['sites'][string]> {
  const config = await loadUserConfig();
  return config.sites?.[host] ?? {};
}

export async function setSiteConfig(host: string, patch: UserConfig['sites'][string]): Promise<void> {
  const config = await loadUserConfig();
  const merged: UserConfig = {
    ...config,
    sites: { ...config.sites, [host]: { ...config.sites?.[host], ...patch } },
  };
  await browser.storage.sync.set({ [SYNC_KEY]: merged });
}
