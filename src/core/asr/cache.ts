import { fnv1a } from '@/core/shared/utils';
import type { AsrCue } from './types';

/**
 * ASR 结果缓存（storage.local）
 * 键：asr:<provider>:<lang>:<audioFingerprint> —— 用**音频字节指纹**而不是视频 URL，
 * 这样换清晰度、换签名参数、seek 回看命中同一段音频时都能复用。
 */

const PREFIX = 'asr:';

export interface AsrCacheEntry {
  cues: AsrCue[];
  createdAt: number;
  provider: string;
  lang: string;
}

export interface AsrCacheArea {
  /** 传 null 表示「取全部键」（用于清空） */
  get(keys: string[] | null): Promise<Record<string, unknown>>;
  set(entries: Record<string, unknown>): Promise<void>;
  remove(keys: string[]): Promise<void>;
}

/** 音频指纹：按步长抽样 + 总长度参与哈希，避免整段 1.4MB 逐字节遍历 */
export function audioFingerprint(wav: ArrayBuffer): string {
  const view = new Uint8Array(wav);
  const step = Math.max(1, Math.floor(view.length / 4096));
  let acc = '';
  for (let i = 0; i < view.length; i += step) acc += String.fromCharCode(view[i]);
  return `${fnv1a(`${view.length}:${acc}`)}-${view.length.toString(16)}`;
}

export function asrCacheKey(provider: string, lang: string, fingerprint: string): string {
  return `${PREFIX}${provider}:${lang || 'auto'}:${fingerprint}`;
}

export async function getAsrCache(
  area: AsrCacheArea,
  key: string,
  ttlDays: number,
): Promise<AsrCacheEntry | null> {
  const stored = await area.get([key]);
  const entry = stored[key] as AsrCacheEntry | undefined;
  if (!entry || !Array.isArray(entry.cues)) return null;
  if (ttlDays > 0) {
    const ageMs = Date.now() - (entry.createdAt ?? 0);
    if (ageMs > ttlDays * 86_400_000) {
      await area.remove([key]).catch(() => undefined);
      return null;
    }
  }
  return entry;
}

export async function setAsrCache(
  area: AsrCacheArea,
  key: string,
  entry: AsrCacheEntry,
): Promise<void> {
  await area.set({ [key]: entry });
}

/** 清空全部 ASR 缓存（设置页按钮） */
export async function clearAsrCache(area: AsrCacheArea): Promise<number> {
  const all = await area.get(null);
  const keys = Object.keys(all).filter((k) => k.startsWith(PREFIX));
  if (keys.length > 0) await area.remove(keys);
  return keys.length;
}
