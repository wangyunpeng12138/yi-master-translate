import type {
  CustomAiService,
  DisplayMode,
  FloatBallClickType,
  ServiceId,
  SiteTranslateMode,
  TermLibrary,
  TranslationPosition,
} from '@/core/shared/types';
import type { AsrProviderId } from '@/core/asr/types';

/**
 * 默认配置（三层合并的第 1 层）
 * 键名迁移映射见 docs/实现方案.md 附录 A（原 default_config.json → 本工程）。
 */

export interface UserConfig {
  /** 扩展总开关（原版关于页「启用扩展」） */
  app: {
    enabled: boolean;
  };
  /** 基本设置 */
  general: {
    targetLanguage: string; // 目标语言（原 translationService 之外的语言偏好）
    interfaceLanguage: 'zh-CN' | 'en';
    service: ServiceId; // 默认翻译服务（原 translationService: bing）
    displayMode: DisplayMode; // 原 translationMode: dual
    sameLangTheme: 'none' | 'background'; // 原 sameLangTranslationTheme
    translationTheme: string; // 译文显示样式主题
    translationPosition: TranslationPosition; // 原 translationPosition: after
    translationMark: boolean; // 译文起始标识：每段译文首带背景色「译」小标签（译大师新增）
    forceNoneThemeUrls: string[]; // 强制「无」样式的域名
  };
  /** 引擎（原分散在 default_config 顶层的段落行为参数） */
  engine: {
    minParagraphChars: number; // 原「翻译段落所需的最少字符数」= 2
    preTranslateChars: number; // 原 immediateTranslationTextCount = 4999
    translateWholePage: boolean; // 是否翻译网页所有区域（默认智能识别主区域）
    translateSidebar: boolean; // 原「启用侧边栏翻译」
    translateTitle: boolean; // 原「开启翻译网页标题」
    translateToPageEndImmediately: boolean; // 原「进入网页后立即翻译到页面底部」（不推荐）
    sameLangCheck: boolean; // 原 sameLangCheck: true
    loadingTheme: 'spinner' | 'text' | 'none'; // 原 loadingTheme: spinner
    longParagraphWrap: boolean; // 长段落自动换行
    autoTranslateInSite: boolean; // 站内页面自动翻译
    tempAutoTranslateMinutes: number; // 原 tempTranslateDomainMinutes = 0
    onlyTranslationLangs: string[]; // 仅译文模式的语言（原 translationModeLanguagePattern）
    onlyTranslationUrls: string[]; // 仅译文模式的网址
    translationStartMode: 'dynamic' | 'static'; // 原翻译启动模式
  };
  /** 输入框翻译 */
  inputbox: {
    enabled: boolean; // 原 enableInputTranslation: true
    triggerKey: string; // 原 inputTrailingTriggerKey: 'space'
    repeat: number; // 原 inputTrailingTriggerKeyRepeatTimes: 3
    timeoutMs: number; // 原 inputTrailingTriggerKeyTimeout: 200
    targetLanguage: string; // 原 inputTargetLanguage: 'en'
    autoDetectChatLang: boolean; // 自动识别对话语言
    autoDetectPageLang: boolean; // 自动识别页面语言
    service: ServiceId; // 'inherit' 时跟随主服务
  };
  /** 划词翻译 */
  selection: {
    enabled: boolean;
    circleSelectEnabled: boolean; // 圈选翻译
    circleSelectKey: string; // 圈选快捷键 Z
    triggerStyle: 'icon' | 'dot'; // 显示图标 / 小圆点
    hoverConfirm: boolean; // 悬浮触发
    autoSpeakWord: boolean; // 单词自动朗读
    sameLangBehavior: 'translate' | 'skip'; // 目标语言与原语言相同时
    blockUrls: string[];
    service: ServiceId; // 划词专用服务（AI）
    aiSearchEnabled: boolean; // 划词 AI 搜索按钮（蓝色，选中后生成中文解释）
    aiSearchService: ServiceId; // 划词 AI 搜索服务（默认 inherit 跟随 AI 搜索/主服务）
  };
  /** 鼠标悬停 */
  hover: {
    holdKey: string; // 悬停翻译触发键；原版默认为字符串哨兵 "Off"（不做任何事情）
    keyTimeoutMs: number; // 原 mouseModifierKeyPressTimeout = 400
    service: ServiceId;
  };
  /** 悬浮球 */
  floatball: {
    enabled: boolean; // 原 pcFloatBall.enable: true
    hoverDelayMs: number; // 原 hoverSidePanelDelay = 500
    transparency: number; // 原 transparency = 30
    clickType: FloatBallClickType; // 原 clickType: translate
    showSidePanelButton: boolean; // 侧边栏按钮显示方式
    blockUrls: string[]; // 原 pcFloatBall.blockUrls
  };
  /** 视频字幕 */
  subtitle: {
    enabled: boolean;
    autoEnableAll: boolean; // 自动开启（所有支持平台）
    showPlayerShortcut: boolean; // 播放器快捷方式
    youtubeAuto: boolean;
    youtubePreferImt: boolean; // 优先用本扩展翻译字幕
    meetingAuto: boolean; // Teams/Zoom/Meet
    preferManualSubtitle: boolean; // 优先人工字幕
    focusDialogue: boolean; // 滤除环境声标注
    service: ServiceId; // 字幕专用服务（inherit）
    displayMode: DisplayMode;
    permanentDisable: boolean; // 永久禁用（冲突时）
  };
  /**
   * 无字幕视频 ASR（方案见 docs/ASR字幕接入方案.md）
   * 产出 cue 数组后走既有字幕翻译管线；本地 Whisper（A2）与云 API（A1）共用同一份配置。
   */
  asr: {
    /** 总开关：默认关闭（会消耗 CPU/带宽，必须用户显式开启） */
    enabled: boolean;
    /** 'auto' = 本地就绪优先、否则按 fallbackOrder 找云；'off' = 等同关闭 */
    provider: 'auto' | 'off' | AsrProviderId;
    auto: {
      whenNoTrack: boolean; // 探测到无字幕轨时自动开始（关闭则等手动触发）
      minWatchSeconds: number; // 播放满 N 秒才开始，避免划走就起任务
      maxDurationMin: number; // 超过该时长建议改云/整片，默认 15 分钟
    };
    /** 音频采集（与 provider 无关：本地/云端都按这个窗口切） */
    capture: {
      windowSec: number; // 单个识别窗口时长（默认 30s）
      strideSec: number; // 相邻窗口重叠，避免切句丢字（默认 5s）
      captureRate: 1 | 1.5 | 2; // 采集时的播放倍速（2× 更快但掉准确率）
    };
    /** 本地 Whisper（A2 落地；A1 只落配置，provider 未注册） */
    local: {
      model: 'whisper-tiny' | 'whisper-base' | 'whisper-small';
      dtype: 'q8' | 'fp16' | 'fp32';
      numThreads: number;
      progressive: boolean;
      modelBaseUrl: string;
    };
    /** 云端 ASR */
    cloud: {
      provider: AsrProviderId;
      endpoint: string; // 空 = 用 provider 默认端点
      apiKey: string; // 实际存 storage.local（见 ASR 方案 §7.2），此处由 storage 注入
      model: string;
      language: 'auto' | string;
      chunkMinutes: number;
      timeoutMs: number;
      /** 主 provider 失败后依次尝试 */
      fallbackOrder: AsrProviderId[];
    };
    /** 产出字幕之后的处理（翻译服务/显示模式与 subtitle.* 有意分离） */
    pipeline: {
      translate: boolean;
      service: ServiceId; // 'inherit' = 跟随字幕设置
      displayMode: 'dual' | 'only' | 'inherit';
    };
    cache: { enabled: boolean; ttlDays: number };
  };
  /** 图片/漫画 */
  image: {
    hoverButtonEnabled: boolean; // 图片快捷翻译按钮（原 imageRule.enableTools）
    hoverButtonDelayMs: number; // 200
    hoverTranslate: boolean; // 悬停触发图片翻译（原 imageRule.enableMouseHover）
    provider: 'local' | 'custom'; // 原 imageRule.imageTranslateProvider: "client"（本地 OCR，clientSupportLangs 16 语含日）
    mangaEnabled: boolean;
    service: ServiceId;
  };
  /** 右键菜单与上下文 */
  contextMenu: {
    enabled: boolean; // 原 isShowContextMenu: true
  };
  /** AI 搜索（段落术语解释：与翻译服务分离，必须 AI 服务才能解释术语） */
  explain: {
    enabled: boolean; // 译文后显示 AI 搜索按钮
    service: ServiceId; // AI 搜索专用服务（inherit = 跟随翻译服务；机翻无解释能力，建议选 AI 服务）
    cacheDays: number; // 解释缓存天数（0 = 不缓存）
  };
  /** 快捷键（扩展内记录层；浏览器级由 manifest commands 管理） */
  shortcuts: Record<string, string>;
  /** AI 专家 */
  ai: {
    enabled: boolean; // 原 enableAiAssistant；默认关闭：免费机器通道用不到专家提示词，
    //    且未配置自定义 AI 服务时开启无实际效果（评审后对齐用户直觉）
    activeExpertId: string; // 'general'
    /** 用户全局追加提示词：注入 AI 服务系统提示词末尾（领域定制），与专家提示词叠加 */
    promptAppend: string;
    experts: Array<{ id: string; name: string; prompt: string; builtin?: boolean }>;
  };
  /** 术语库 */
  terms: {
    showActiveHighlights: boolean; // 显示已生效术语
    libraries: TermLibrary[];
  };
  /** 自定义服务 */
  customServices: CustomAiService[];
  /** 缓存 */
  cache: {
    enabled: boolean; // 开启本地翻译缓存
  };
  /** 网络代理（译大师新增能力：翻译接口经本地代理转发，应对直连不可达环境） */
  network: {
    proxyEnabled: boolean; // 开启后接管浏览器代理：命中 proxyDomains 的请求走代理，其余直连
    proxyHost: string;
    proxyPort: number;
    proxyType: 'http' | 'socks5';
    proxyDomains: string[]; // 走代理的域名（内置免费通道域；自定义 AI 服务域名自动并入）
  };
  /** 开发者 */
  developer: {
    debugLog: boolean;
    beta: boolean;
    userRules: string; // JSON 文本（站点规则覆盖）
    injectedCss: string;
  };
  /** 各站点独立设置（popup「当前网站翻译设置」） */
  sites: Record<string, { translateMode?: SiteTranslateMode; forceWhole?: boolean }>;
}

export const DEFAULT_CONFIG: UserConfig = {
  app: {
    enabled: true,
  },
  general: {
    targetLanguage: 'zh-CN',
    interfaceLanguage: 'zh-CN',
    service: 'bing',
    displayMode: 'dual',
    sameLangTheme: 'background',
    translationTheme: 'none',
    translationPosition: 'after',
    translationMark: true,
    forceNoneThemeUrls: [],
  },
  engine: {
    minParagraphChars: 2,
    preTranslateChars: 4999,
    translateWholePage: false,
    translateSidebar: true,
    translateTitle: true,
    translateToPageEndImmediately: false,
    sameLangCheck: true,
    loadingTheme: 'spinner',
    longParagraphWrap: false,
    autoTranslateInSite: true,
    tempAutoTranslateMinutes: 0,
    onlyTranslationLangs: ['zh-TW'],
    onlyTranslationUrls: [],
    translationStartMode: 'dynamic',
  },
  inputbox: {
    enabled: true,
    triggerKey: 'space',
    repeat: 3,
    timeoutMs: 200,
    targetLanguage: 'en',
    autoDetectChatLang: true,
    autoDetectPageLang: false,
    service: 'inherit',
  },
  selection: {
    enabled: false, // 原版配置默认 false（generalRule.selectionTranslation.enable，评审修正）
    circleSelectEnabled: false,
    circleSelectKey: 'z',
    triggerStyle: 'dot', // 原版默认 triggerMode: "mini"（显示小圆点，评审修正）
    hoverConfirm: true,
    autoSpeakWord: false,
    sameLangBehavior: 'translate',
    blockUrls: [],
    // 'inherit' = 跟随主翻译服务（旧值 'free-ai' 语义保留在 selection.ts 兼容）；
    // 此前默认 'free-ai' 在下拉中无对应项，会裸显原始值且实际解析到 customServices[0]
    service: 'inherit',
    aiSearchEnabled: true, // 选中即出现蓝色 AI 搜索按钮（与翻译按钮并存，可单独关闭）
    aiSearchService: 'inherit', // inherit 解析链：explain.service → general.service
  },
  hover: {
    holdKey: 'Off', // 原版默认字符串哨兵 "Off"（不做任何事情，评审修正）
    keyTimeoutMs: 400,
    service: 'inherit',
  },
  floatball: {
    enabled: true,
    hoverDelayMs: 500,
    transparency: 30,
    clickType: 'translate',
    showSidePanelButton: false,
    blockUrls: ['*localhost*/preview'],
  },
  subtitle: {
    enabled: true,
    autoEnableAll: true,
    showPlayerShortcut: true,
    youtubeAuto: true,
    youtubePreferImt: true,
    meetingAuto: true,
    preferManualSubtitle: true,
    focusDialogue: true,
    service: 'inherit',
    displayMode: 'dual',
    permanentDisable: false,
  },
  asr: {
    enabled: false,
    provider: 'auto',
    auto: {
      whenNoTrack: true,
      minWatchSeconds: 10,
      maxDurationMin: 15,
    },
    capture: {
      windowSec: 30,
      strideSec: 5,
      captureRate: 1,
    },
    local: {
      model: 'whisper-base',
      dtype: 'q8',
      numThreads: 1,
      progressive: true,
      modelBaseUrl: '',
    },
    cloud: {
      provider: 'openai-whisper',
      endpoint: '',
      apiKey: '',
      model: 'whisper-1',
      language: 'auto',
      chunkMinutes: 10,
      timeoutMs: 120_000,
      fallbackOrder: ['groq-whisper', 'local-whisper'],
    },
    pipeline: {
      translate: true,
      service: 'inherit',
      displayMode: 'inherit',
    },
    cache: { enabled: true, ttlDays: 30 },
  },
  image: {
    hoverButtonEnabled: false,
    hoverButtonDelayMs: 200,
    hoverTranslate: true,
    provider: 'local',
    mangaEnabled: true,
    service: 'inherit',
  },
  contextMenu: {
    enabled: true,
  },
  explain: {
    enabled: true,
    service: 'inherit',
    cacheDays: 30,
  },
  shortcuts: {
    toggleTranslatePage: 'Alt+A',
    toggleTranslateTheWholePage: 'Alt+W',
    toggleSidePanel: 'Alt+S',
    translateInputBox: 'Alt+I',
  },
  ai: {
    enabled: false,
    activeExpertId: 'general',
    promptAppend: '',
    experts: [
      { id: 'general', name: '通用', builtin: true, prompt: '' },
      { id: 'tech', name: '科技领域', builtin: true, prompt: 'You are a professional technology translator.' },
      { id: 'paper', name: '学术论文', builtin: true, prompt: 'Use academic tone and precise terminology.' },
      { id: 'legal', name: '法律文本', builtin: true, prompt: 'Use rigorous legal terminology.' },
      { id: 'financial', name: '金融领域', builtin: true, prompt: 'Use standard financial terminology.' },
    ],
  },
  terms: {
    showActiveHighlights: false, // 原版配置默认 false（评审修正；UI 实测显示开为运行态/实验开关所致）
    libraries: [],
  },
  customServices: [],
  cache: {
    enabled: true,
  },
  network: {
    proxyEnabled: false,
    proxyHost: '127.0.0.1',
    proxyPort: 7890,
    proxyType: 'http',
    proxyDomains: [
      'translate.googleapis.com',
      'translate.google.com',
      'edge.microsoft.com',
      'wxapp.translator.qq.com',
    ],
  },
  developer: {
    debugLog: false,
    beta: false,
    userRules: '',
    injectedCss: '',
  },
  sites: {},
};
