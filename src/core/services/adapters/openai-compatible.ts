import type { UserConfig } from '@/core/config/defaults';
import type { AdapterOptions, ServiceAdapter } from '../types';
import { ServiceError } from '../types';

/**
 * OpenAI 兼容适配器（覆盖原版自定义服务语义）
 * - 槽位：openai-custom / claude-custom / 用户自定义 customServices
 * - 可配：apiKey / apiUrl（Base URL 或完整地址）/ model / temperature / 请求体模板
 * - 提示词：系统提示词（翻译角色 + 专家 + 术语）+ 用户提示词（Translate to {{to}}: {{text}}）
 * - P2 为逐段基础版；批量增强模式（分批/完整性校验/局部重试）在 P6 以 aiBatch 接入
 */

const DEFAULT_SYSTEM_PROMPT =
  'You are a professional translator. Translate the user text into {{to}} accurately and fluently. Keep the meaning, tone and formatting. Preserve code, placeholders and untranslated-proper nouns.{{expert}}{{terms}} Return ONLY the translated text without any explanation.';

const DEFAULT_USER_PROMPT = 'Translate to {{to}}:\n\n{{text}}'; // 注意两个换行，与原版逐字对齐（评审 2.2-12）

const PRESETS: Record<string, { apiUrl: string; model: string }> = {
  'openai-custom': { apiUrl: 'https://api.openai.com/v1/chat/completions', model: 'gpt-4o-mini' },
  'claude-custom': { apiUrl: 'https://api.anthropic.com/v1/messages', model: 'claude-3-5-haiku-latest' },
};

interface ChatResponse {
  choices?: Array<{ message?: { content?: string | Array<{ text?: string }> } }>;
  content?: Array<{ text?: string }>;
}

function resolveEndpoint(config: UserConfig, serviceId: string): {
  apiKey: string;
  apiUrl: string;
  model: string;
  temperature: number;
  requestBodyTemplate?: string;
  systemPrompt?: string;
  userPrompt?: string;
} {
  const custom = config.customServices.find((c) => c.id === serviceId);
  const preset = PRESETS[serviceId];
  if (custom && custom.apiKey) {
    return {
      apiKey: custom.apiKey,
      apiUrl: normalizeApiUrl(custom.apiUrl || preset?.apiUrl || 'https://api.openai.com/v1/chat/completions'),
      model: custom.model || preset?.model || 'gpt-4o-mini',
      temperature: custom.temperature ?? 0,
      requestBodyTemplate: custom.requestBodyTemplate,
      systemPrompt: custom.systemPrompt,
      userPrompt: custom.userPrompt,
    };
  }
  throw new ServiceError(
    `service ${serviceId} needs API key setup`,
    'no-key',
  );
}

function isAnthropic(url: string): boolean {
  return url.includes('anthropic.com');
}

/**
 * API 地址归一化（对齐原版行为）：用户常填 Base URL（如 https://api.deepseek.com/v1），
 * 自动补全为完整 chat 端点；已填完整地址（/chat/completions 或 /messages）则原样使用。
 * 此前直接 POST 原值导致 Base URL 场景 404（实测：127.0.0.1:3425/v1 → 404）。
 */
function normalizeApiUrl(raw: string): string {
  const url = raw.trim().replace(/\/+$/, ''); // 去尾斜杠
  if (url.endsWith('/chat/completions') || url.endsWith('/messages')) return url;
  if (isAnthropic(url)) return `${url}/messages`;
  return `${url}/chat/completions`;
}

function fill(template: string, params: Record<string, string>): string {
  return template.replaceAll(/\{\{(\w+)\}\}/g, (_, k: string) => params[k] ?? '');
}

async function translateOne(
  text: string,
  _from: string, // 保留对齐适配器签名（AI 服务由模型自行识别源语言）
  to: string,
  ep: ReturnType<typeof resolveEndpoint>,
  opts: AdapterOptions | undefined,
): Promise<string> {
  const anthropic = isAnthropic(ep.apiUrl);
  const termsBlock =
    opts?.terms && opts.terms.length > 0
      ? `\nUse these fixed term translations: ${opts.terms
          .map((t) => `${t.from} => ${t.to}`)
          .join('; ')}.`
      : '';
  // 非翻译场景（AI 搜索/术语解释）：systemOverride 整体替换默认翻译系统提示词，
  // 避免默认「翻译并只返回译文」指令与解释指令冲突
  const systemPrompt = opts?.systemOverride
    ? fill(opts.systemOverride, { to, text: '' })
    : fill(ep.systemPrompt || DEFAULT_SYSTEM_PROMPT, {
        to,
        expert: opts?.expertPrompt ? `\n${opts.expertPrompt}` : '',
        terms: termsBlock,
      });
  // 用户全局追加提示词：注入 system 末尾（领域定制，与专家提示词叠加；构造后追加
  // 以保证对用户完全自定义 systemPrompt 的服务也生效）
  const finalSystem = opts?.promptAppend ? `${systemPrompt}\n${opts.promptAppend}` : systemPrompt;
  const userPrompt = fill(ep.userPrompt || DEFAULT_USER_PROMPT, { to, text });

  let body: Record<string, unknown>;
  if (anthropic) {
    body = {
      model: ep.model,
      max_tokens: 4096,
      temperature: ep.temperature,
      system: finalSystem,
      messages: [{ role: 'user', content: userPrompt }],
    };
  } else {
    body = {
      model: ep.model,
      temperature: ep.temperature,
      messages: [
        { role: 'system', content: finalSystem },
        { role: 'user', content: userPrompt },
      ],
    };
  }
  // 请求体模板：用户提供的顶层字段覆盖默认值
  if (ep.requestBodyTemplate && ep.requestBodyTemplate.trim()) {
    try {
      Object.assign(body, JSON.parse(ep.requestBodyTemplate));
    } catch {
      // 模板非法时忽略并继续（对齐原版"修改后完整替换这一项"的宽容处理）
    }
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (anthropic) {
    headers['x-api-key'] = ep.apiKey;
    headers['anthropic-version'] = '2023-06-01';
  } else {
    headers.Authorization = `Bearer ${ep.apiKey}`;
  }

  const res = await fetch(ep.apiUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: opts?.signal,
  });
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 200);
    throw new ServiceError(`HTTP ${res.status}: ${detail}`, 'http');
  }
  const data = (await res.json()) as ChatResponse;
  let content = '';
  if (anthropic) {
    content = (data.content ?? [])
      .map((c) => c?.text ?? '')
      .join('')
      .trim();
  } else {
    const msg = data.choices?.[0]?.message?.content;
    if (typeof msg === 'string') content = msg.trim();
    else if (Array.isArray(msg)) content = msg.map((m) => m?.text ?? '').join('').trim();
  }
  if (!content) throw new ServiceError('empty AI response', 'parse');
  return content;
}

export function openaiCompatibleAdapter(config: UserConfig, serviceId: string): ServiceAdapter {
  return {
    id: serviceId,
    batchLimit: 8,
    maxRps: 5,
    async translate(texts, from, to, opts) {
      const ep = resolveEndpoint(config, serviceId);
      // AI 服务逐段请求（基础版）；外层 RateLimiter 控速
      const out: string[] = [];
      for (const text of texts) {
        out.push(await translateOne(text, from, to, ep, opts));
      }
      return out;
    },
  };
}
