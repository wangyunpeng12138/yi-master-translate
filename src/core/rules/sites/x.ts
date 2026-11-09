import type { SiteRule } from '../types';

/**
 * x.com / twitter.com 站点规则
 *
 * 2026-11-09 真机实测（Chrome 157，未登录渲染器）：
 *  - 全页 `data-testid` 数量 = 0，旧混沌类名（css-xxxx/r-xxxx）数量 = 0
 *  - 新版渲染器用 Tailwind 风格类名：`article.group/post`、`div.@container/post-actions`
 *  - 推文正文：`div[dir="auto"].max-w-full.text-lead`（含 whitespace-pre-wrap 便于保留换行）
 *  - 互动数条：`div[role="group"][aria-label="6 转帖、39 点赞…"]`
 *  - 页面 `html[lang]` 是**界面语言**（zh-cn），不能用来判断内容语言
 *
 * 因此这里同时保留两套选择器：新版（结构+语义）优先，旧版（data-testid）兜底，
 * 以兼容登录态可能仍是旧渲染器的情况。
 */
export const X_RULE: SiteRule = {
  id: 'x',
  matches: [
    'x.com',
    'www.x.com',
    'mobile.x.com',
    'pro.x.com',
    'twitter.com',
    'www.twitter.com',
    'mobile.twitter.com',
    'platform.x.com/embed*',
    'platform.twitter.com/embed*',
  ],
  excludeMatches: [
    'x.com/settings*',
    'x.com/jobs/*',
    'x.com/*/tos*',
    'x.com/*/privacy*',
    'x.com/account/access*',
    'x.com/i/premium_sign_up',
    'x.com/i/chat*',
    'twitter.com/settings*',
    'twitter.com/jobs/*',
  ],

  /* ---------- 正文段落 ---------- */
  selectors: [
    // 新版渲染器（2026）：推文/长文正文容器
    'article div[dir="auto"][class*="text-lead"]',
    'article div[dir="auto"][class*="whitespace-pre-wrap"]',
    // 旧版渲染器：data-testid 契约
    "[data-testid='tweetText']",
    "[data-testid='twitterArticleReadView']",
    'article .x-article-body',
    "[data-testid='longformRichTextComponent']",
    "[data-testid='UserDescription']",
    "[data-testid='HoverCard'] div[dir=auto]",
    "[data-testid='HoverCard'] span[dir=auto]",
    "[data-testid='birdwatch-pivot'] div[dir=ltr]",
    "[data-testid='card.layoutLarge.detail'] > div:nth-child(2)",
    "[data-testid='card.layoutSmall.detail'] > div:nth-child(2)",
    "[data-testid='UserCell'] > div > div:nth-child(2)",
    "[data-testid='inlinePrompt']",
  ],

  /* 推文正文被拆成多个 span/div（实体、话题、@ 分片），这些不单独成段，随父容器整段翻译 */
  inlineSelectors: [
    'article div[dir="auto"][class*="text-lead"] span',
    'article div[dir="auto"][class*="text-lead"] div',
    "[data-testid='tweetText'] span",
    "[data-testid='tweetText'] div",
    "[data-testid='UserDescription'] div",
  ],

  /* ---------- 永不翻译 ---------- */
  excludeSelectors: [
    'header',
    'nav',
    "[role='tab']",
    'time',
    // 新版渲染器：互动数条（转帖/点赞/书签/观看数）
    "[role='group'][aria-label]",
    // 旧版渲染器：用户名、社交上下文、「显示更多」、侧栏、播放器
    "[data-testid='User-Name']",
    "[data-testid='UserProfileHeader_Items']",
    "[data-testid='socialContext']",
    "[data-testid='tweet-text-show-more-link']",
    "[data-testid='sidebarColumn']",
    "[data-testid='videoComponent']",
    "[data-testid='hoverCardParent'] [role=menuitem]",
    "[aria-label='Grok']",
    // 自家产物
    '.imt-rebuild-target-wrapper',
    '.imt-rebuild-loading',
    '.imt-rebuild-explain-btn',
    '.imt-caption-container',
    '.imt-rebuild-floatball-wrap',
  ],

  minChars: 2,
  minWords: 1,
  translateTitle: false,
  skipSameLangCheck: true,

  injectedCss: [
    // 长推文/卡片默认被 line-clamp 截断，译文会被裁掉
    "[data-testid='tweetText'],[style*='-webkit-line-clamp'] {-webkit-line-clamp: unset !important;}",
  ],
};
