import type { UserConfig } from '@/core/config/defaults';
import { AsrError, type AsrProvider, type AsrProviderId } from './types';
import { createOpenAiAsrProvider, resolveAsrEndpoint } from './providers/openai-asr';
import { createDeepgramProvider } from './providers/deepgram';
import { createLocalWhisperProvider } from './providers/local-whisper';

/**
 * ASR provider 注册表
 *
 * 设计要点（对齐 docs/ASR字幕接入方案.md §4）：
 * - `listAsrProviders` 供设置页渲染（**UI 不写死 provider 列表**）
 * - `getAsrChain` 给出「本次实际要尝试的 provider 顺序」（含降级链）
 * - 新增一个 provider = 本文件加一条记录 + 一个适配器文件，调用方与 UI 都不用改
 */

const IMPLEMENTED: AsrProviderId[] = [
  'local-whisper',
  'openai-whisper',
  'groq-whisper',
  'deepgram',
  'whisper-cpp-server',
  'custom-openai-asr',
];

/** 声明但未实现（UI 上灰显，避免用户配了却不生效还不知道原因） */
const DECLARED_ONLY: AsrProviderId[] = [];

const LOCAL_IDS: AsrProviderId[] = ['local-whisper'];

export function isAsrProviderImplemented(id: string): boolean {
  return IMPLEMENTED.includes(id as AsrProviderId);
}

export function createAsrProvider(config: UserConfig, id: AsrProviderId): AsrProvider {
  const cloud = config.asr.cloud;
  switch (id) {
    case 'local-whisper':
      return createLocalWhisperProvider(config);
    case 'openai-whisper':
    case 'groq-whisper':
    case 'whisper-cpp-server':
    case 'custom-openai-asr':
      return createOpenAiAsrProvider(id, cloud);
    case 'deepgram':
      return createDeepgramProvider(cloud);
    default:
      throw new AsrError(`未知 ASR provider: ${String(id)}`, 'unsupported');
  }
}

/** 供设置页渲染的 provider 元数据（含是否已实现 + 解析后的端点） */
export function listAsrProviders(config: UserConfig): Array<{
  id: AsrProviderId;
  name: string;
  implemented: boolean;
  kind: 'local' | 'cloud';
  needsKey: boolean;
  needsEndpoint: boolean;
  offline: boolean;
  supportsTimestamps: boolean;
  models: string[];
  defaultEndpoint: string;
  resolvedEndpoint: string;
}> {
  const out: Array<ReturnType<typeof listAsrProviders>[number]> = [];
  for (const id of IMPLEMENTED) {
    try {
      const p = createAsrProvider(config, id);
      out.push({
        id,
        name: p.name,
        implemented: true,
        kind: p.capabilities.kind,
        needsKey: p.capabilities.needsKey,
        needsEndpoint: p.capabilities.needsEndpoint,
        offline: p.capabilities.offline,
        supportsTimestamps: p.capabilities.supportsTimestamps,
        models: p.capabilities.models,
        defaultEndpoint: p.capabilities.defaultEndpoint ?? '',
        resolvedEndpoint: resolveAsrEndpoint(id, config.asr.cloud),
      });
    } catch {
      /* 单个 provider 构造失败不应影响整表 */
    }
  }
  for (const id of DECLARED_ONLY) {
    out.push({
      id,
      name: '本地 Whisper（未接入）',
      implemented: false,
      kind: 'local',
      needsKey: false,
      needsEndpoint: false,
      offline: true,
      supportsTimestamps: true,
      models: ['whisper-tiny', 'whisper-base', 'whisper-small'],
      defaultEndpoint: '',
      resolvedEndpoint: '',
    });
  }
  return out;
}

/**
 * 本次请求要依次尝试的 provider 链
 * - asr.provider = 'off' 或 enabled=false → 空数组（完全不启用）
 * - 'auto'   → 已实现的本地 provider（A2 后）优先，然后 cloud.provider，再按 fallbackOrder
 * - 具体 id  → 它自己 + fallbackOrder（去重、过滤未实现项）
 */
export function getAsrChain(config: UserConfig): AsrProviderId[] {
  if (!config.asr.enabled || config.asr.provider === 'off') return [];
  const chain: AsrProviderId[] = [];
  const push = (id: AsrProviderId | string | undefined) => {
    if (!id || id === 'auto' || id === 'off' || id === 'inherit') return;
    if (!isAsrProviderImplemented(id)) return;
    if (!chain.includes(id as AsrProviderId)) chain.push(id as AsrProviderId);
  };
  if (config.asr.provider === 'auto') {
    // auto：本地优先（模型未下载时 provider 会快速失败，自动落到云端）
    push('local-whisper');
  } else {
    push(config.asr.provider);
  }
  push(config.asr.cloud.provider);
  for (const id of config.asr.cloud.fallbackOrder ?? []) push(id);
  return chain;
}

/** 该 provider 是否跑在 offscreen（调用前需要先确保 offscreen 文档存活） */
export function isLocalAsrProvider(id: AsrProviderId): boolean {
  return LOCAL_IDS.includes(id);
}

/** 是否至少有一个可用 provider（配置层面；不代表网络可用） */
export function hasUsableAsrProvider(config: UserConfig): boolean {
  return getAsrChain(config).length > 0;
}
