/**
 * 配置合并工具（三层合并：defaults → 站点规则 overlay → 用户 patch）
 * 保留原版数组合并语义的简化实现。
 */

type Plain = Record<string, unknown>;

export function isPlainObject(v: unknown): v is Plain {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * 深合并：patch 中的数组直接整体覆盖（原版 `.add`/`.remove` 后缀语义不做）；
 * 普通对象递归合并；undefined / null 视为删除该键。
 */
export function deepMerge<T>(base: T, patch: unknown): T {
  if (patch === undefined || patch === null) {
    return structuredClone(base);
  }
  if (!isPlainObject(patch)) {
    return patch as T;
  }
  const out: Plain = isPlainObject(base) ? { ...(base as Plain) } : {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) {
      delete out[key];
      continue;
    }
    if (isPlainObject(value) && isPlainObject(out[key])) {
      out[key] = deepMerge(out[key], value);
    } else {
      out[key] = value;
    }
  }
  return out as T;
}

/** 计算用户 patch（defaults 与 merged 的差集），用于导出精简配置文件 */
export function diffPatch<T>(defaults: T, merged: T): Plain {
  const out: Plain = {};
  if (!isPlainObject(defaults) || !isPlainObject(merged)) return out;
  for (const [key, value] of Object.entries(merged)) {
    const def = (defaults as Plain)[key];
    if (isPlainObject(value) && isPlainObject(def)) {
      const sub = diffPatch(def, value);
      if (Object.keys(sub).length > 0) out[key] = sub;
    } else if (JSON.stringify(value) !== JSON.stringify(def)) {
      out[key] = value;
    }
  }
  return out;
}
