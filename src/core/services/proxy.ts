import type { UserConfig } from '@/core/config/defaults';
import type { CustomAiService } from '@/core/shared/types';

/**
 * 网络代理（background 专用，需 manifest "proxy" 权限）
 *
 * 实现方式：chrome.proxy + PAC 脚本按域分流。
 * 为什么不用别的方案：
 * - fetch 标准无 proxy 参数，SW 内无法逐请求指定代理；
 * - 全局 fixed_servers 会接管全部流量，PAC 可做到「仅翻译域走代理、其余 DIRECT」。
 *
 * 注意（用户须知）：
 * - chrome.proxy 是浏览器级设置：开启后非翻译域名一律 DIRECT（不再走系统代理）；
 * - 上游出口（Clash/V2Ray 分流规则）决定目标域最终能否可达，本扩展只负责送进代理。
 */

/** 免费通道域名（新免费服务接入时同步维护） */
const FREE_PROXY_DOMAINS = [
  'translate.googleapis.com',
  'translate.google.com',
  'edge.microsoft.com',
  'wxapp.translator.qq.com',
];

/** 从自定义服务配置提取全部需要代理的 host（含内置 AI 预设兜底域名） */
function collectCustomDomains(config: UserConfig): string[] {
  const hosts = new Set<string>();
  for (const s of (config.customServices ?? []) as Array<Partial<CustomAiService>>) {
    const url = s?.apiUrl;
    if (!url) continue;
    try {
      hosts.add(new URL(url).hostname);
    } catch {
      // 非法 URL 配置忽略
    }
  }
  // 内置 AI 槽位的预设域名（未配置 apiUrl 时的 fallback 端点）
  hosts.add('api.openai.com');
  hosts.add('api.anthropic.com');
  return [...hosts];
}

/** 生成 PAC 脚本：命中清单 → 本地代理；其余 → DIRECT */
export function buildPacScript(config: UserConfig): string {
  const n = config.network;
  const hosts = new Set<string>([
    ...FREE_PROXY_DOMAINS,
    ...(n.proxyDomains ?? []),
    ...collectCustomDomains(config),
  ]);
  const scheme = n.proxyType === 'socks5' ? 'SOCKS5' : 'PROXY';
  const server = `${scheme} ${n.proxyHost}:${n.proxyPort}`;
  const matcher = [...hosts]
    .filter(Boolean)
    .map((h) => `shExpMatch(host, "${h}")`)
    .join(' || ');
  // shExpMatch(host, "a.com") 精确匹配；".a.com" 写法可匹配子域，保持用户输入原样
  return [
    'function FindProxyForURL(url, host) {',
    `  if (${matcher}) { return "${server}"; }`,
    '  return "DIRECT";',
    '}',
  ].join('\n');
}

/** 根据配置应用/清除浏览器代理（幂等，SW 启动与配置变化时调用） */
export async function applyProxySettings(config: UserConfig): Promise<void> {
  const chromeApi = (globalThis as { chrome?: { proxy?: ChromeProxySettings } }).chrome;
  const proxy = chromeApi?.proxy;
  if (!proxy?.settings) {
    // 权限缺失或环境不支持时静默（不阻断翻译链路）
    console.warn('[imt-rebuild] chrome.proxy 不可用，跳过代理设置');
    return;
  }
  try {
    if (config.network.proxyEnabled) {
      const pacData = buildPacScript(config);
      await proxy.settings.set({
        value: { mode: 'pac_script', pacScript: { data: pacData } },
        scope: 'regular',
      });
    } else {
      await proxy.settings.clear({ scope: 'regular' });
    }
  } catch (e) {
    console.error('[imt-rebuild] 应用代理设置失败:', e);
  }
}

/* ---------- 本地 AI 服务 CORS 兼容（Ollama 等） ----------
 * 实测（Ollama 0.30.9）：扩展 SW fetch 自动携带 Origin: chrome-extension://<id>，
 * Ollama 的 OLLAMA_ORIGINS 默认白名单不含浏览器扩展 → HTTP 403 直接拒绝。
 * 用 DNR modifyHeaders（需 declarativeNetRequestWithHostAccess，已具备）对
 * 用户配置的自定义服务端点移除 Origin 头，让本地服务视为非浏览器请求放行。
 * session 规则（重启浏览器自动消失，每次 SW 启动/配置变化时重建）。
 */

const LOCAL_SERVICE_DNR_RULE_ID = 900001;

export async function applyLocalServiceDnr(config: UserConfig): Promise<void> {
  const chromeApi = (globalThis as { chrome?: { declarativeNetRequest?: ChromeDnrApi } }).chrome;
  const dnr = chromeApi?.declarativeNetRequest;
  if (!dnr?.updateSessionRules) {
    console.warn('[imt-rebuild] chrome.declarativeNetRequest 不可用，跳过本地服务规则');
    return;
  }
  try {
    // 幂等：先移除旧规则
    await dnr.updateSessionRules({ removeRuleIds: [LOCAL_SERVICE_DNR_RULE_ID] });
    // 从自定义服务端点提取主机（域名部分；requestDomains 匹配不含端口）
    const domains = new Set<string>();
    for (const s of (config.customServices ?? []) as Array<Partial<CustomAiService>>) {
      const url = s?.apiUrl;
      if (!url) continue;
      try {
        domains.add(new URL(url).hostname);
      } catch {
        // 非法 URL 忽略
      }
    }
    if (domains.size === 0) return;
    await dnr.updateSessionRules({
      addRules: [
        {
          id: LOCAL_SERVICE_DNR_RULE_ID,
          priority: 1,
          condition: {
            requestDomains: [...domains],
            resourceTypes: ['xmlhttprequest' as never, 'other' as never],
          },
          action: {
            type: 'modifyHeaders' as never,
            requestHeaders: [{ header: 'Origin', operation: 'remove' as never }],
          },
        },
      ],
    });
  } catch (e) {
    console.error('[imt-rebuild] 本地服务 DNR 规则更新失败:', e);
  }
}

/** chrome.declarativeNetRequest 最小类型声明（@types/chrome 兼容） */
interface ChromeDnrApi {
  updateSessionRules(details: {
    removeRuleIds?: number[];
    addRules?: Array<{
      id: number;
      priority: number;
      condition: { requestDomains: string[]; resourceTypes: string[] };
      action: {
        type: 'modifyHeaders';
        requestHeaders: Array<{ header: string; operation: string }>;
      };
    }>;
  }): Promise<void>;
}

/** chrome.proxy 最小类型声明（@types/chrome 的 chrome.proxy 兼容） */
interface ChromeProxySettings {
  settings: {
    set(details: {
      value: { mode: 'pac_script'; pacScript: { data: string } };
      scope: 'regular';
    }): Promise<void>;
    clear(details: { scope: 'regular' }): Promise<void>;
  };
}
