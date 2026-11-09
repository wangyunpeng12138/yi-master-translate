import type { UserConfig } from '@/core/config/defaults';
import { AsrError, type AsrCue, type AsrProvider, type AsrRequest } from '../types';

/**
 * OpenAI 兼容 ASR 适配器（一次实现覆盖 4 个 provider）
 * - openai-whisper    : POST {endpoint}/v1/audio/transcriptions   model=whisper-1
 * - groq-whisper      : 同上（Groq 提供 OpenAI 兼容层，默认端点不同）
 * - whisper-cpp-server: POST {endpoint}/inference                 （whisper.cpp server 亦支持 verbose_json）
 * - custom-openai-asr : 任意自建兼容端点
 *
 * 时间戳统一取 `segments[]`（response_format=verbose_json）；上游只回 `text` 时
 * 退化为「整段一条」（仍可翻译，只是不分句）。
 */

interface Preset {
  id: AsrProvider['id'];
  name: string;
  defaultEndpoint: string;
  defaultModel: string;
  /** whisper.cpp server 的路由是 /inference，不是 /v1/audio/transcriptions */
  inferencePath: string;
  needsKey: boolean;
  needsEndpoint: boolean;
  models: string[];
}

const PRESETS: Record<string, Preset> = {
  'openai-whisper': {
    id: 'openai-whisper',
    name: 'OpenAI Whisper',
    defaultEndpoint: 'https://api.openai.com',
    defaultModel: 'whisper-1',
    inferencePath: '/v1/audio/transcriptions',
    needsKey: true,
    needsEndpoint: false,
    models: ['whisper-1', 'gpt-4o-transcribe'],
  },
  'groq-whisper': {
    id: 'groq-whisper',
    name: 'Groq Whisper（快）',
    defaultEndpoint: 'https://api.groq.com/openai',
    defaultModel: 'whisper-large-v3-turbo',
    inferencePath: '/v1/audio/transcriptions',
    needsKey: true,
    needsEndpoint: false,
    models: ['whisper-large-v3-turbo', 'whisper-large-v3'],
  },
  'whisper-cpp-server': {
    id: 'whisper-cpp-server',
    name: '自建 whisper.cpp',
    defaultEndpoint: 'http://127.0.0.1:8080',
    defaultModel: 'base',
    inferencePath: '/inference',
    needsKey: false,
    needsEndpoint: true,
    models: [],
  },
  'custom-openai-asr': {
    id: 'custom-openai-asr',
    name: '自定义 OpenAI 兼容 ASR',
    defaultEndpoint: '',
    defaultModel: 'whisper-1',
    inferencePath: '/v1/audio/transcriptions',
    needsKey: false,
    needsEndpoint: true,
    models: [],
  },
};

export type AsrCloudConfig = UserConfig['asr']['cloud'];

function trimSlash(s: string): string {
  return s.replace(/\/+$/, '');
}

/** 该 provider 实际使用的端点（配置留空时回落到默认值） */
export function resolveAsrEndpoint(id: AsrProvider['id'], cfg: AsrCloudConfig): string {
  const preset = PRESETS[id];
  return trimSlash(cfg.endpoint || preset?.defaultEndpoint || '');
}

export function createOpenAiAsrProvider(id: AsrProvider['id'], cfg: AsrCloudConfig): AsrProvider {
  const preset = PRESETS[id];
  if (!preset) throw new AsrError(`未知 ASR provider: ${id}`, 'unsupported');

  return {
    id: preset.id,
    name: preset.name,
    capabilities: {
      kind: 'cloud',
      needsKey: preset.needsKey,
      needsEndpoint: preset.needsEndpoint,
      offline: false,
      supportsTimestamps: true,
      maxAudioSec: 600, // 25MB ≈ 10 分钟（16k/16bit/单声道）
      models: preset.models,
      langs: 'auto',
      defaultEndpoint: preset.defaultEndpoint,
      audioFormat: 'wav',
    },
    async transcribe(req: AsrRequest): Promise<AsrCue[]> {
      const base = resolveAsrEndpoint(preset.id, cfg);
      if (!base) throw new AsrError('未配置 ASR 端点（endpoint）', 'no-provider');
      if (preset.needsKey && !cfg.apiKey) throw new AsrError('未配置 API Key', 'no-key');

      const url = `${base}${preset.inferencePath}`;
      const form = new FormData();
      form.append('file', new Blob([req.wav], { type: 'audio/wav' }), 'audio.wav');
      form.append('model', cfg.model || preset.defaultModel);
      form.append('response_format', 'verbose_json');
      const lang = cfg.language || req.language;
      if (lang && lang !== 'auto') form.append('language', lang);

      const headers: Record<string, string> = {};
      if (cfg.apiKey) headers.authorization = `Bearer ${cfg.apiKey}`;

      const timeoutMs = cfg.timeoutMs ?? 120_000;
      const controller = new AbortController();
      const onAbort = () => controller.abort(new DOMException('aborted', 'AbortError'));
      req.signal?.addEventListener('abort', onAbort, { once: true });
      const timer = setTimeout(
        () => controller.abort(new DOMException('timeout', 'TimeoutError')),
        timeoutMs,
      );

      let res: Response;
      try {
        res = await fetch(url, { method: 'POST', headers, body: form, signal: controller.signal });
      } catch (e) {
        const err = e as Error;
        if (err.name === 'AbortError') throw new AsrError('ASR 请求已取消', 'aborted');
        if (err.name === 'TimeoutError') throw new AsrError(`ASR 请求超时（${timeoutMs}ms）`, 'timeout');
        throw new AsrError(`ASR 网络错误：${err.message}`, 'http');
      } finally {
        clearTimeout(timer);
        req.signal?.removeEventListener('abort', onAbort);
      }

      if (res.status === 401 || res.status === 403) {
        throw new AsrError(`ASR 鉴权失败（HTTP ${res.status}），请检查 API Key`, 'auth');
      }
      if (res.status === 429) {
        throw new AsrError('ASR 触发限流（HTTP 429），请稍后再试', 'quota');
      }
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new AsrError(`ASR HTTP ${res.status}：${body.slice(0, 200)}`, 'http');
      }

      let json: {
        text?: string;
        segments?: Array<{ start?: number; end?: number; text?: string }>;
      };
      try {
        json = (await res.json()) as typeof json;
      } catch {
        throw new AsrError('ASR 响应不是合法 JSON', 'parse');
      }

      const segments = (json.segments ?? [])
        .map((s) => ({
          start: Number(s.start ?? 0),
          end: Number(s.end ?? s.start ?? 0),
          text: (s.text ?? '').trim(),
        }))
        .filter((s) => s.text.length > 0);
      if (segments.length > 0) return segments;

      // 退化：只回 text 的端点 → 整段一条
      const text = (json.text ?? '').trim();
      return text ? [{ start: 0, end: req.durationSec, text }] : [];
    },
  };
}
