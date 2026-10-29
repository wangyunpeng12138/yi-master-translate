/**
 * 翻译缓存统计与清理（UI 通用：关于页 / popup 更多功能 / 侧边栏共用）
 * 缓存键统一在 chrome.storage.local 的 `cache:` 前缀下（见 core/services/cache.ts）
 */

export interface CacheStats {
  entries: number;
  bytes: number;
}

export async function getCacheStats(): Promise<CacheStats> {
  const all = (await browser.storage.local.get(null)) as Record<string, unknown>;
  let entries = 0;
  let bytes = 0;
  for (const [k, v] of Object.entries(all)) {
    if (!k.startsWith('cache:')) continue;
    entries += 1;
    bytes += k.length + JSON.stringify(v ?? '').length;
  }
  return { entries, bytes };
}

export async function clearTranslationCache(): Promise<CacheStats> {
  const all = (await browser.storage.local.get(null)) as Record<string, unknown>;
  const keys = Object.keys(all).filter((k) => k.startsWith('cache:'));
  if (keys.length > 0) await browser.storage.local.remove(keys);
  return { entries: 0, bytes: 0 };
}

export function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}
