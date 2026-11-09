import type { UserConfig } from '@/core/config/defaults';
import { AsrError, type AsrCue, type AsrProvider, type AsrRequest } from '../types';

/**
 * Deepgram 适配器（/v1/listen）
 * - 认证用 `Authorization: Token <key>`（不是 Bearer）
 * - 时间戳从 `results.channels[0].alternatives[0].words[]` 聚合成句
 * - 显式要求 16kHz 单声道，避免服务端重采样带来的对齐漂移
 */

export type AsrCloudConfig = UserConfig['asr']['cloud'];

interface Word {
  word?: string;
  start?: number;
  end?: number;
  punctuated_word?: string;
}

/** 把逐词结果按标点/停顿聚成句，作为字幕 cue */
function wordsToCues(words: Word[], maxGapSec = 0.8): AsrCue[] {
  const cues: AsrCue[] = [];
  let buf: Word[] = [];
  const flush = () => {
    if (buf.length === 0) return;
    const start = buf[0].start ?? 0;
    const end = buf[buf.length - 1].end ?? start;
    const text = buf.map((w) => w.punctuated_word ?? w.word ?? '').join(' ').trim();
    if (text) cues.push({ start, end, text });
    buf = [];
  };
  for (const w of words) {
    if (buf.length > 0) {
      const prevEnd = buf[buf.length - 1].end ?? 0;
      const gap = (w.start ?? prevEnd) - prevEnd;
      if (gap > maxGapSec) flush();
    }
    buf.push(w);
    if (/[.!?。！？]$/.test(w.punctuated_word ?? w.word ?? '')) flush();
  }
  flush();
  return cues;
}

export function createDeepgramProvider(cfg: AsrCloudConfig): AsrProvider {
  return {
    id: 'deepgram',
    name: 'Deepgram Nova',
    capabilities: {
      kind: 'cloud',
      needsKey: true,
      needsEndpoint: false,
      offline: false,
      supportsTimestamps: true,
      maxAudioSec: 600,
      models: ['nova-2', 'nova-3'],
      langs: 'auto',
      defaultEndpoint: 'https://api.deepgram.com',
      audioFormat: 'wav',
    },
    async transcribe(req: AsrRequest): Promise<AsrCue[]> {
      if (!cfg.apiKey) throw new AsrError('未配置 Deepgram API Key', 'no-key');
      const base = (cfg.endpoint || 'https://api.deepgram.com').replace(/\/+$/, '');
      const params = new URLSearchParams({
        model: cfg.model || 'nova-2',
        smart_format: 'true',
        utterances: 'false',
        encoding: 'linear16',
        sample_rate: '16000',
        channels: '1',
      });
      if (cfg.language && cfg.language !== 'auto') params.set('language', cfg.language);

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
        res = await fetch(`${base}/v1/listen?${params.toString()}`, {
          method: 'POST',
          headers: {
            authorization: `Token ${cfg.apiKey}`,
            'content-type': 'audio/wav',
          },
          // Deepgram 接受原始音频二进制（不要 multipart）
          body: new Blob([req.wav], { type: 'audio/wav' }),
          signal: controller.signal,
        });
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
        throw new AsrError(`Deepgram 鉴权失败（HTTP ${res.status}）`, 'auth');
      }
      if (res.status === 429) throw new AsrError('Deepgram 触发限流（HTTP 429）', 'quota');
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new AsrError(`Deepgram HTTP ${res.status}：${body.slice(0, 200)}`, 'http');
      }

      const json = (await res.json().catch(() => null)) as {
        results?: { channels?: Array<{ alternatives?: Array<{ words?: Word[]; transcript?: string }> }> };
      } | null;
      if (!json) throw new AsrError('Deepgram 响应不是合法 JSON', 'parse');

      const alt = json.results?.channels?.[0]?.alternatives?.[0];
      const words = alt?.words ?? [];
      if (words.length > 0) return wordsToCues(words);

      const transcript = (alt?.transcript ?? '').trim();
      return transcript ? [{ start: 0, end: req.durationSec, text: transcript }] : [];
    },
  };
}
