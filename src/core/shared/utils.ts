/** FNV-1a 32 位哈希（缓存键；避免依赖 crypto 性能问题） */
export function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** 简易文本规范化（trim + 连续空白折叠），保证缓存命中一致性 */
export function normalizeText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 判定文本是否「基本无翻译价值」（纯符号/数字/极短） */
export function isTranslatable(text: string, minChars = 2): boolean {
  const normalized = normalizeText(text);
  if (normalized.length < minChars) return false;
  return /[\p{L}\p{N}]/u.test(normalized);
}
