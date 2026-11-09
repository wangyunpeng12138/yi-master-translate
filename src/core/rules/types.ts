/**
 * 站点规则类型（x.com 适配第一版：只实现确实用到的字段）
 * 参考沉浸式翻译 v1.34.4 的站点规则（default_config.json rules[i]）裁剪而来。
 */
export interface SiteRule {
  id: string;
  /** host 或 host+path 模式，支持 * 通配；如 'x.com'、'x.com/settings*'、'platform.x.com/embed*' */
  matches: string[];
  excludeMatches?: string[];

  /* ---------- 段落识别 ---------- */
  /** 显式段落选择器（优先于启发式候选集） */
  selectors?: string[];
  /** 内部视为行内、随父容器整段翻译（当前实现靠容器 innerText 天然覆盖，保留字段供后续精细控制） */
  inlineSelectors?: string[];
  /** 永不翻译的区域 */
  excludeSelectors?: string[];

  minChars?: number;
  minWords?: number;

  /* ---------- 行为覆写 ---------- */
  /** 是否翻译网页标题（X 的标题恒为「X 上的 xxx」，无意义） */
  translateTitle?: boolean;
  /**
   * 跳过「页面语言 == 目标语言」的整页判定。
   * 场景：x.com 的 html[lang] 是**界面语言**（跟随账号/IP），不是内容语言，
   * 用它会误判「整页已是中文」而一条不翻。
   */
  skipSameLangCheck?: boolean;

  /* ---------- 呈现 ---------- */
  injectedCss?: string[];
}
