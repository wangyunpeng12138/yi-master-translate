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

/* ---------- 段落语言检测（对齐原版 locale-chinese 检测器 Ss 的轻量实现） ---------- */

// 汉字（简繁统一：基本区 + 扩A + 兼容区）
const HAN_RE = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFA6D]/g;
// 假名（平假名 + 片假名）
const KANA_RE = /[\u3040-\u309F\u30A0-\u30FF]/g;
// 谚文
const HANGUL_RE = /[\uAC00-\uD7AF]/g;

/**
 * 段落语言启发式检测（字符集级，非 n-gram）：
 * - 假名占比 > 0.1 → ja（对齐原版 o.ja/i > .1）
 * - 谚文占比 > 0.1 → ko（对齐原版 o.ko/i > .1）
 * - 汉字加权占比 > 0.5 → zh（对齐原版 r*2.5/i > .5）
 * - 拉丁语系无法靠字符集可靠区分（英/法/德），返回 auto 不做段落过滤
 */
export function detectTextLang(text: string): 'zh' | 'ja' | 'ko' | 'auto' {
  const clean = text.replace(/\s+/g, '');
  const total = clean.length;
  if (total === 0) return 'auto';
  const kana = clean.match(KANA_RE)?.length ?? 0;
  if (kana / total > 0.1) return 'ja';
  const hangul = clean.match(HANGUL_RE)?.length ?? 0;
  if (hangul / total > 0.1) return 'ko';
  const han = clean.match(HAN_RE)?.length ?? 0;
  if ((han * 2.5) / total > 0.5) return 'zh';
  return 'auto';
}

/**
 * 段落语言与目标语言相同 → 该段落无需翻译（跳过收集）。
 * 中英混排页面只翻外文、中文段落原样保留（对齐原版行为）；
 * 同时避免中文段落被翻译服务检测为「目标语言」后反向互译成外语。
 */
export function isSameTargetLang(text: string, targetLang: string): boolean {
  const detected = detectTextLang(text);
  if (detected === 'auto') return false;
  const t = targetLang.toLowerCase();
  if (detected === 'zh') return /^zh/.test(t);
  if (detected === 'ja') return /^ja/.test(t);
  return /^ko/.test(t);
}
