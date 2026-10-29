import type { UserConfig } from '@/core/config/defaults';
import type { ServiceDefinition, ServiceAdapter } from './types';
import { bingAdapter } from './adapters/bing';
import { googleAdapter } from './adapters/google';
import { transmartAdapter } from './adapters/transmart';
import { openaiCompatibleAdapter, isLocalUrl } from './adapters/openai-compatible';

/**
 * 服务注册表（对齐原版分组：免费机器翻译 + 自定义 AI 槽位）
 */

export const BUILTIN_SERVICES: ServiceDefinition[] = [
  {
    id: 'bing',
    name: '微软翻译',
    kind: 'machine',
    builtin: true,
    batchLimit: 50,
    defaultMaxRps: 5,
  },
  {
    // 原版免费变体（extends: bing）——同一实现双 id，导入原版配置时 bing-free 可解析（评审 3.2-⑤）
    id: 'bing-free',
    name: '微软翻译（免费）',
    kind: 'machine',
    builtin: true,
    batchLimit: 50,
    defaultMaxRps: 5,
  },
  {
    id: 'google',
    name: '谷歌翻译',
    kind: 'machine',
    builtin: true,
    batchLimit: 10,
    defaultMaxRps: 5,
  },
  {
    id: 'google-free',
    name: '谷歌翻译（免费）',
    kind: 'machine',
    builtin: true,
    batchLimit: 10,
    defaultMaxRps: 5,
  },
  {
    // 腾讯 TranSmart 免费通道（原版 transmart-free 同源；国内可直连，微软/谷歌域不可达环境的可靠备选）
    id: 'transmart',
    name: '腾讯 TranSmart',
    kind: 'machine',
    builtin: true,
    batchLimit: 1,
    defaultMaxRps: 3,
  },
  {
    id: 'openai-custom',
    name: 'OpenAI 兼容接口',
    kind: 'ai',
    builtin: true,
    batchLimit: 8,
    defaultMaxRps: 5,
    needsKey: true,
    needsSetup: true,
  },
  {
    id: 'claude-custom',
    name: 'Claude（OpenAI 兼容代理）',
    kind: 'ai',
    builtin: true,
    batchLimit: 8,
    defaultMaxRps: 5,
    needsKey: true,
    needsSetup: true,
  },
  {
    id: 'deeplx',
    name: 'DeepLX（自建端点）',
    kind: 'machine',
    builtin: true,
    batchLimit: 20,
    defaultMaxRps: 5,
    needsSetup: true,
  },
];

/** 列出可选服务（内置 + 用户自定义槽位命名） */
export function listServices(config?: UserConfig): ServiceDefinition[] {
  const custom = (config?.customServices ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    kind: 'ai' as const,
    builtin: false,
    batchLimit: 8,
    defaultMaxRps: c.maxRps || 5,
    needsKey: true,
    // 本地回环地址（Ollama 等）无鉴权可空 key，视为已配置（ServicePicker aiOnly 过滤依赖）
    needsSetup: !c.apiKey && !isLocalUrl(c.apiUrl),
  }));
  const seen = new Set(custom.map((c) => c.id));
  return [...custom, ...BUILTIN_SERVICES.filter((s) => !seen.has(s.id))];
}

/** 获取适配器实例；service = 'inherit' 时回落到主服务 */
export function getAdapter(config: UserConfig, serviceId: string): ServiceAdapter {
  const id = serviceId === 'inherit' ? config.general.service : serviceId;
  switch (id) {
    case 'bing':
    case 'bing-free': // 同一适配器双 id（评审 3.2-⑤）
      return bingAdapter();
    case 'google':
    case 'google-free':
      return googleAdapter(config);
    case 'transmart':
    case 'transmart-free':
      return transmartAdapter();
    case 'deeplx':
      return openaiCompatibleAdapter(config, 'deeplx');
    case 'openai-custom':
    case 'claude-custom':
      return openaiCompatibleAdapter(config, id);
    default:
      // 用户自定义服务
      if (config.customServices.some((c) => c.id === id)) {
        return openaiCompatibleAdapter(config, id);
      }
      throw new Error(`Unknown translation service: ${id}`);
  }
}
