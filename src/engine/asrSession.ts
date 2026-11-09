import type { UserConfig } from '@/core/config/defaults';
import { arrayBufferToBase64, encodeWav, hasUsableAsrProvider, type AsrCue } from '@/core/asr';
import type { AsrTranscribeResult } from '@/core/messaging/protocol';
import { AudioTap } from './asrAudioTap';
import { createCaptionLayer } from './captionLayer';
import { translateTexts } from './translator';

/**
 * 无字幕视频的 ASR 会话（A1：云端 provider；本地 Whisper 在 A2 接入同一编排）
 *
 * 流程：无字幕轨探测 → AudioTap 采集 16k PCM → 30s 滚动窗口切 WAV →
 *       background 调 provider 识别 → cue 按窗口偏移拼接 → 批量翻译 → 浮层按时间轴显示
 *
 * 与 P8a 的关系：有 `<track>` 的视频一律走 subtitle.ts，本模块只在「无轨」时接管。
 */

interface SessionItem {
  start: number;
  end: number;
  text: string;
  translation: string;
  state: 'pending' | 'translated' | 'error';
}

export interface AsrSessionHandle {
  stop(): void;
  readonly video: HTMLVideoElement;
}

const sessions = new WeakMap<HTMLVideoElement, AsrSessionHandle>();

export function hasCaptionTrack(video: HTMLVideoElement): boolean {
  if (video.querySelector('track')) return true;
  const tracks = video.textTracks;
  for (let i = 0; i < tracks.length; i++) {
    const t = tracks[i];
    if (t.kind !== 'subtitles' && t.kind !== 'captions') continue;
    // 有轨即可（即使还没加载 cue，站点已有 CC，就不该抢）
    return true;
  }
  return false;
}

function findSourceIndex(items: SessionItem[], time: number): number {
  // 字幕通常 1–2 条同时存在，线性扫描足够（window 内最多几十条）
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    if (time >= it.start && time <= it.end) return i;
  }
  return -1;
}

/** 窗口 RMS（0–1）：用于判断是否纯静音/纯音乐，避免把静音送进 Whisper 产生幻觉 */
function rms(pcm: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < pcm.length; i++) sum += pcm[i] * pcm[i];
  return Math.sqrt(sum / Math.max(1, pcm.length));
}

/**
 * 压缩 Whisper 的「复读幻觉」：连续重复的 n-gram（n=3..8）只保留一次，超过 4 次重复的整句丢弃。
 * 典型症状：静音/音乐段输出 "…who are in the world who are in the world…" 刷屏。
 */
export function cleanRepeated(text: string): string {
  const words = text.trim().split(/\s+/);
  if (words.length < 9) return text.trim();
  for (let n = 3; n <= 8; n++) {
    for (let i = 0; i + n * 3 <= words.length; i++) {
      const unit = words.slice(i, i + n).join(' ');
      let reps = 1;
      while (
        i + (reps + 1) * n <= words.length &&
        words.slice(i + reps * n, i + (reps + 1) * n).join(' ') === unit
      ) {
        reps += 1;
      }
      if (reps >= 3) {
        // 保留一份，删掉其余重复
        words.splice(i + n, (reps - 1) * n);
        if (reps >= 5) return words.slice(0, i + n).join(' '); // 过度复读：只留前半段
      }
    }
  }
  return words.join(' ');
}

/** 启动一个视频的 ASR 会话；若该视频已有字幕轨或已在会话中，返回 null */
export async function startAsrSession(
  video: HTMLVideoElement,
  config: UserConfig,
): Promise<AsrSessionHandle | null> {
  const skip = (reason: string): null => {
    console.info(`[imt-rebuild] ASR 未启动：${reason}`);
    return null;
  };
  if (sessions.has(video)) return sessions.get(video) ?? null;
  if (!config.asr.enabled) return skip('asr.enabled=false');
  if (!hasUsableAsrProvider(config)) return skip('没有可用的 ASR provider（检查 provider/fallbackOrder）');
  if (hasCaptionTrack(video)) return skip('该视频已有字幕轨，走轨道翻译');
  if (video.mediaKeys) {
    // DRM 内容拿不到音轨（方案 §1.2）
    return skip('受 DRM 保护的视频');
  }
  const duration = video.duration;
  if (Number.isFinite(duration) && duration > config.asr.auto.maxDurationMin * 60) {
    return skip(`视频时长超过上限（${Math.round(duration)}s）`);
  }

  const sampleRate = 16_000;
  const layer = createCaptionLayer(video, {
    translationPosition: config.subtitle.translationPosition,
  });
  const items: SessionItem[] = [];
  const pending = new Set<string>();
  let stopped = false;
  let tap: AudioTap | null = null;
  let buffer: Float32Array = new Float32Array(0);
  let consumedSamples = 0;
  let inFlight = false;
  let lastShownIndex = -1;
  let rafId = 0;

  /** 先占位再 await：否则两次并发调用（play 事件 + 初始扫描）会各建一套采集与浮层 */
  const stopNow = () => {
    if (stopped) return;
    stopped = true;
    cancelAnimationFrame(rafId);
    tap?.stop();
    layer.destroy();
    sessions.delete(video);
  };
  const handle: AsrSessionHandle = { stop: stopNow, video };
  sessions.set(video, handle);

  const winSamples = Math.max(1, Math.round(config.asr.capture.windowSec * sampleRate));
  const strideSamples = Math.max(0, Math.round(config.asr.capture.strideSec * sampleRate));

  const setBusyStatus = (text: string | null) => layer.setStatus(text);

  const render = () => {
    if (stopped) return;
    rafId = requestAnimationFrame(render);
    const time = video.currentTime;
    const idx = findSourceIndex(items, time);
    if (idx === lastShownIndex) return;
    lastShownIndex = idx;
    if (idx < 0) {
      layer.hide();
      return;
    }
    const it = items[idx];
    layer.setStatus(null);
    layer.show(it.text, it.translation);
    if (it.state === 'pending') layer.setStatus('翻译中…');
  };

  /** 把一批识别结果并入 items，并按需翻译 */
  const ingest = async (cues: AsrCue[]) => {
    const fresh: SessionItem[] = [];
    for (const c of cues) {
      const text = cleanRepeated(c.text);
      if (!text) continue;
      // 纯标注/噪声（「[Music]」「(掌声)」）不展示
      if (/^[\[(（【].*[\])）】]$/.test(text) && !/[\p{L}\p{N}]/u.test(text.replace(/[\[(（【\])）】]/g, ''))) {
        continue;
      }
      // 重叠窗口会产生重复 cue：同文本且时间接近的丢弃
      const dup = items.some((it) => it.text === text && Math.abs(it.start - c.start) < 1.5);
      if (dup) continue;
      if (pending.has(text)) continue;
      const item: SessionItem = {
        start: c.start,
        end: Math.max(c.end, c.start + 0.4),
        text,
        translation: '',
        state: 'pending',
      };
      items.push(item);
      fresh.push(item);
      pending.add(text);
    }
    if (fresh.length === 0) return;
    items.sort((a, b) => a.start - b.start);

    if (!config.asr.pipeline.translate) {
      fresh.forEach((it) => {
        it.state = 'translated';
        pending.delete(it.text);
      });
      return;
    }

    try {
      const service =
        config.asr.pipeline.service && config.asr.pipeline.service !== 'inherit'
          ? config.asr.pipeline.service
          : config.subtitle.service;
      const translations = await translateTexts(
        fresh.map((it) => it.text),
        'auto',
        config.general.targetLanguage,
        service,
        'subtitle',
      );
      fresh.forEach((it, i) => {
        it.translation = (translations[i] ?? '').trim();
        it.state = it.translation ? 'translated' : 'error';
        pending.delete(it.text);
      });
    } catch (e) {
      fresh.forEach((it) => {
        it.state = 'error';
        pending.delete(it.text);
      });
      console.warn('[imt-rebuild] ASR 字幕翻译失败：', e);
    }
  };

  /** 发送一个窗口去识别 */
  const flushWindow = async (pcm: Float32Array, offsetSec: number) => {
    if (inFlight || stopped) return;
    inFlight = true;
    setBusyStatus('识别中…');
    try {
      const wav = encodeWav(pcm, sampleRate);
      const res = (await browser.runtime.sendMessage({
        type: 'asr:transcribe',
        payload: {
          wavBase64: arrayBufferToBase64(wav),
          offsetSec,
          durationSec: pcm.length / sampleRate,
          language: config.asr.cloud.language,
        },
      })) as AsrTranscribeResult;
      if (stopped) return;
      if (!res || res.ok !== true) {
        const message = res && res.ok === false ? res.message : 'ASR 无响应';
        setBusyStatus(`识别失败：${message}`);
        console.warn('[imt-rebuild] ASR 失败：', res);
        return;
      }
      setBusyStatus(null);
      await ingest(res.cues);
    } catch (e) {
      if (!stopped) setBusyStatus(`识别失败：${(e as Error).message}`);
    } finally {
      inFlight = false;
    }
  };

  const onPcm = (chunk: Float32Array) => {
    if (stopped) return;
    const merged = new Float32Array(buffer.length + chunk.length);
    merged.set(buffer, 0);
    merged.set(chunk, buffer.length);
    buffer = merged;

    while (buffer.length >= winSamples) {
      const slice = buffer.slice(0, winSamples);
      const offsetSec = consumedSamples / sampleRate;
      consumedSamples += winSamples - strideSamples;
      buffer = buffer.slice(winSamples - strideSamples);
      // 静音门限：纯静音/极低音量窗口不送识别（省钱、防幻觉）
      const minRms = config.asr.capture.silenceRms ?? 0;
      if (minRms > 0 && rms(slice) < minRms) continue;
      void flushWindow(slice, offsetSec);
      if (inFlight) break; // 单飞：识别没回来之前不堆窗口
    }

    // 长时间拿到全零 → 判定被污染/静音，给出一次提示后停止采集
    if (tap && tap.totalSamples > sampleRate * 8 && tap.peakAmplitude < 1e-4) {
      setBusyStatus('没有采集到声音（可能被站点静音或跨域限制）');
      stopNow();
    }
  };

  try {
    tap = await AudioTap.attach(video, { sampleRate, onPcm });
  } catch (e) {
    layer.setStatus(`无法采集音频：${(e as Error).message}`);
    layer.destroy();
    sessions.delete(video);
    return null;
  }

  setBusyStatus('正在识别音频…');
  rafId = requestAnimationFrame(render);

  // 自动播放策略：AudioContext 可能一直是 suspended（拿不到任何样本）。
  // 一次点击即可解锁；用 **捕获阶段** 监听，避免被上层 UI（播放器 CC 芯片等）
  // 的 stopPropagation 挡掉（实测：点芯片开字幕时一直停在"等待音频"）。
  const unlockOnClick = () => void tap?.resume();
  document.addEventListener('pointerdown', unlockOnClick, { capture: true, once: true });
  const stallTimer = window.setTimeout(() => {
    if (stopped) return;
    if (tap && tap.totalSamples === 0) {
      setBusyStatus('等待音频…点击视频任意位置以开始识别');
    }
  }, 4000);

  const stopWithTimers = () => {
    window.clearTimeout(stallTimer);
    document.removeEventListener('pointerdown', unlockOnClick, true);
    stopNow();
  };
  // 覆盖 handle.stop（外部调用时也要清掉定时器与监听）
  handle.stop = stopWithTimers;

  return handle;
}

/** 页面级：为所有符合条件的 video 建立 ASR 会话（幂等） */
export async function scanAndStartAsr(config: UserConfig): Promise<void> {
  if (!config.asr.enabled || !config.asr.auto.whenNoTrack) return;
  const videos = [...document.querySelectorAll('video')] as HTMLVideoElement[];
  for (const video of videos) {
    if (sessions.has(video)) continue;
    if (video.paused) continue;
    if (hasCaptionTrack(video)) continue;
    void startAsrSession(video, config);
  }
}

/** 停止全部会话（关闭翻译 / 配置变更 / 页面卸载） */
export function stopAllAsrSessions(): void {
  document.querySelectorAll('video').forEach((v) => {
    sessions.get(v as HTMLVideoElement)?.stop();
  });
}

/** 该视频是否已有 ASR 会话在跑（播放器按钮判断状态用） */
export function hasAsrSession(video: HTMLVideoElement): boolean {
  return sessions.has(video);
}

/** 停止某个视频的 ASR 会话（播放器按钮"关闭字幕"用） */
export function stopAsrSession(video: HTMLVideoElement): void {
  sessions.get(video)?.stop();
  sessions.delete(video);
}

export function initAsr(config: UserConfig): void {
  if (!config.asr.enabled) return;
  // 「检测到无字幕时自动识别」关闭时，播放不再自动起任务（只能从播放器 CC 按钮手动开）
  if (!config.asr.auto.whenNoTrack) return;
  // 播放是用户手势后的信号：此时建立 AudioContext 不会被打成 suspended
  document.addEventListener(
    'play',
    (e) => {
      const video = e.target as HTMLVideoElement;
      if (video?.tagName !== 'VIDEO') return;
      const waited = Number(video.dataset.imtAsrWaited ?? 0);
      if (waited >= config.asr.auto.minWatchSeconds) {
        void startAsrSession(video, config);
        return;
      }
      const timer = window.setInterval(() => {
        const now = Number(video.dataset.imtAsrWaited ?? 0) + 1;
        video.dataset.imtAsrWaited = String(now);
        if (video.paused || video.ended) {
          window.clearInterval(timer);
          return;
        }
        if (now >= config.asr.auto.minWatchSeconds) {
          window.clearInterval(timer);
          void startAsrSession(video, config);
        }
      }, 1000);
    },
    true,
  );

  // 初始化时已在播放的视频（多为自动播放静音流）也尝试接管
  void scanAndStartAsr(config);
}
