import { fnv1a, normalizeText } from '@/core/shared/utils';

/**
 * 翻译缓存（对齐原版「本地翻译缓存：减少重复段落的翻译请求」）
 * - key = namespace:service:from>to:hash(normalizedText)
 * - 内存 map 优先命中，storage 兜底（构造注入，便于单测）
 */

export interface CacheArea {
  get(keys?: string[] | null): Promise<Record<string, string>>;
  set(entries: Record<string, string>): Promise<void>;
}

export class TranslateCache {
  private mem = new Map<string, string>();

  constructor(
    private readonly area: CacheArea,
    private readonly namespace = 'cache',
    private readonly maxEntries = 3000,
  ) {}

  static key(service: string, from: string, to: string, text: string): string {
    return `${service}:${from}>${to}:${fnv1a(normalizeText(text))}`;
  }

  private scopedKey(key: string): string {
    return `${this.namespace}:${key}`;
  }

  /** 批量查询命中：返回 key → 译文 */
  async query(keys: string[]): Promise<Record<string, string>> {
    const hits: Record<string, string> = {};
    const miss: string[] = [];
    for (const key of keys) {
      const v = this.mem.get(key);
      if (v !== undefined) hits[key] = v;
      else miss.push(key);
    }
    if (miss.length > 0) {
      const scoped = miss.map((k) => this.scopedKey(k));
      const stored = await this.area.get(scoped);
      for (const k of miss) {
        const v = stored[this.scopedKey(k)];
        if (v !== undefined) {
          hits[k] = v;
          this.mem.set(k, v);
        }
      }
    }
    return hits;
  }

  /** 批量写入 */
  async put(entries: Record<string, string>): Promise<void> {
    if (Object.keys(entries).length === 0) return;
    for (const [k, v] of Object.entries(entries)) {
      this.mem.set(k, v);
    }
    const scoped: Record<string, string> = {};
    for (const [k, v] of Object.entries(entries)) {
      scoped[this.scopedKey(k)] = v;
    }
    if (this.mem.size > this.maxEntries) {
      // 简易容量控制：超限清空内存层（storage 保留，下次惰性加载）
      this.mem.clear();
    }
    await this.area.set(scoped);
  }

  /** 当前缓存条数（内存层；用于 UI 展示） */
  get size(): number {
    return this.mem.size;
  }
}
