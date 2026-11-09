import type { UserConfig } from '@/core/config/defaults';
import { normalizeText } from '@/core/shared/utils';
import { translateTexts } from './translator';
import { hasAsrSession, startAsrSession, stopAsrSession } from './asrSession';
import {
  hasPlayerLoadedCaptions,
  hasTrackCaptionSession,
  startTrackCaptionSession,
  stopTrackCaptionSession,
} from './trackCaptionSession';

/**
 * 视频字幕引擎（P8a：track 拦截方案）+ 单视频开关（播放器 CC 按钮用）
 *
 * 两条来源：
 * 1. 站点自带字幕轨（`<track>` 或播放器建的 TextTrack）→ 抓 VTT → 翻译 → 重建双语 VTT
 * 2. 无字幕轨（ASR）→ 交给 asrSession（本地 Whisper / 云端）
 *
 * 本文件对外提供「按视频启停」的能力，供播放器快捷按钮调用。
 */

let config: UserConfig | null = null;
let observer: MutationObserver | null = null;

interface VttCue {
  start: string;
  end: string;
  text: string;
}

export function initSubtitle(c: UserConfig): void {
  config = c;
  if (!c.subtitle.enabled || c.subtitle.permanentDisable) return;
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scan, { once: true });
  } else {
    scan();
  }
  observer = new MutationObserver(() => scan());
  observer.observe(document.documentElement, { childList: true, subtree: true });

  // 播放器灌 cues 的站点（x.com 等）：没有可抓的 VTT 文件，靠"接管 TextTrack"实现自动双语。
  // 不能只听 'play'：站点常自动播放（静音起播），此时不会有新的 play 事件；
  // 因此同时听 playing/volumechange/seeked，并用低频巡检兜住"取消静音后才该接管"的情况。
  document.addEventListener('play', onMediaStart, true);
  document.addEventListener('playing', onMediaStart, true);
  document.addEventListener('volumechange', onMediaStart, true);
  document.addEventListener('seeked', onMediaStart, true);
  autoStartTimer = window.setInterval(() => {
    const vids = [...document.querySelectorAll('video')] as HTMLVideoElement[];
    vids.forEach((v) => maybeAutoStart(v));
  }, 2000);
  console.info(
    `[imt-rebuild] subtitle 自动接管已启用（autoEnableAll=${String(c.subtitle.autoEnableAll)}，视频数=${document.querySelectorAll('video').length}）`,
  );
}

let autoStartTimer: number | undefined;

function onMediaStart(e: Event): void {
  const video = e.target as HTMLVideoElement;
  if (video?.tagName === 'VIDEO') maybeAutoStart(video);
}

/** 自动接管：视频在播放且未静音、有字幕轨、尚无会话 → 起 TextTrack 会话 */
function maybeAutoStart(video: HTMLVideoElement): void {
  const c = config;
  if (!c || !c.subtitle.enabled || c.subtitle.permanentDisable) return;
  if (!c.subtitle.autoEnableAll) return;
  if (video.paused || video.muted) return; // 静音自动播放/暂停状态不打扰
  if (getVideoSubtitleState(video).active) return;
  const hasFileTrack = [...video.querySelectorAll('track')].some(
    (t) => (t as HTMLTrackElement).src && !(t as HTMLTrackElement).src.startsWith('data:'),
  );
  if (hasFileTrack) {
    console.info('[imt-rebuild] 自动接管跳过：该视频有真实 VTT 文件轨（走 scan 重建）');
    return;
  }
  if (!hasPlayerLoadedCaptions(video)) return; // 无轨 → 交给 ASR（用户可点 CC 手动开）
  console.info('[imt-rebuild] 检测到播放器字幕轨 → 启动 TextTrack 会话');
  void startTrackCaptionSession(video, c);
}

export function disposeSubtitle(): void {
  observer?.disconnect();
  observer = null;
  if (autoStartTimer) {
    window.clearInterval(autoStartTimer);
    autoStartTimer = undefined;
  }
  document.removeEventListener('play', onMediaStart, true);
  document.removeEventListener('playing', onMediaStart, true);
  document.removeEventListener('volumechange', onMediaStart, true);
  document.removeEventListener('seeked', onMediaStart, true);
}

function scan(): void {
  document.querySelectorAll('video').forEach((video) => {
    video.querySelectorAll('track').forEach((track) => {
      void processTrack(track as HTMLTrackElement);
    });
  });
}

/** 该 video 是否已有字幕轨（<track> 或播放器自建的 subtitles/captions 轨） */
export function hasCaptionTrackIn(video: HTMLVideoElement): boolean {
  if (video.querySelector('track')) return true;
  const tracks = video.textTracks;
  for (let i = 0; i < tracks.length; i++) {
    const t = tracks[i];
    if (t.kind === 'subtitles' || t.kind === 'captions') return true;
  }
  return false;
}

/** 把双语版写回 track（`data-imt-orig-src` 保留原地址，便于开关还原） */
async function processTrack(track: HTMLTrackElement): Promise<void> {
  const c = config;
  if (!c) return;
  if (track.dataset.imtRebuild === 'done') return;
  if (!track.src) return;
  // 仅处理 subtitle/cc 类轨道
  if (track.kind && track.kind !== 'subtitles' && track.kind !== 'captions') return;
  // `data:` 是播放器的空占位（x.com 用 data:,WEBVTT 占位，真实字幕走 TextTrack）→ 不处理，
  // 否则会误判"已处理"并挡住后续的 TextTrack 接管（实测踩过）
  if (track.src.startsWith('data:')) return;

  try {
    const res = await fetch(track.src);
    const vtt = await res.text();
    const cues = parseVtt(vtt);
    if (cues.length === 0) return; // 没解析出 cue 就保持未处理状态，允许其它通道接手

    // 去重翻译
    const uniqueTexts = [...new Set(cues.map((x) => x.text).filter((t) => t.length > 0))];
    if (uniqueTexts.length === 0) return;
    const translatedArr = await translateTexts(
      uniqueTexts,
      'auto',
      c.general.targetLanguage,
      c.subtitle.service,
      'subtitle',
    );
    const map = new Map<string, string>();
    uniqueTexts.forEach((t, i) => map.set(t, translatedArr[i] ?? ''));

    // 重建双语 vtt
    const output = rebuildVtt(cues, map, c);
    const blob = new Blob([output], { type: 'text/vtt' });
    const url = URL.createObjectURL(blob);
    if (!track.dataset.imtOrigSrc) track.dataset.imtOrigSrc = track.getAttribute('src') ?? '';
    track.src = url;
    track.dataset.imtRebuild = 'done'; // 只有真正重建成功才标记
    // 展示翻译后的轨道
    requestAnimationFrame(() => {
      try {
        track.track.mode = 'showing';
      } catch {
        /* track 未加载完成时忽略 */
      }
    });
  } catch (e) {
    console.warn('[imt-rebuild] subtitle translate failed:', e);
  }
}

/** 还原单条 track（关闭该视频的字幕时用） */
function restoreTrack(track: HTMLTrackElement): void {
  const orig = track.dataset.imtOrigSrc;
  if (orig) {
    track.src = orig;
    delete track.dataset.imtOrigSrc;
  }
  delete track.dataset.imtRebuild;
  try {
    track.track.mode = 'disabled';
  } catch {
    /* 忽略 */
  }
}

function parseVtt(vtt: string): VttCue[] {
  const cues: VttCue[] = [];
  const blocks = vtt.split(/\r?\n\r?\n/);
  for (const block of blocks) {
    const lines = block.split(/\r?\n/).filter((l) => l.trim().length > 0);
    const timeLineIdx = lines.findIndex((l) => l.includes('-->'));
    if (timeLineIdx < 0) continue;
    const times = lines[timeLineIdx].split('-->');
    if (times.length < 2) continue;
    const text = lines
      .slice(timeLineIdx + 1)
      .join('\n')
      .replace(/<[^>]+>/g, '') // 去 vtt 内联标签
      .trim();
    cues.push({
      start: times[0].trim(),
      end: times[1].trim().split(/\s+/)[0],
      text: normalizeText(text),
    });
  }
  return cues;
}

function rebuildVtt(cues: VttCue[], map: Map<string, string>, c: UserConfig): string {
  const out: string[] = ['WEBVTT', ''];
  for (const cue of cues) {
    const translated = map.get(cue.text) ?? '';
    const body =
      c.subtitle.displayMode === 'only' || !cue.text
        ? translated || cue.text
        : `${cue.text}\n${translated}`;
    out.push(`${cue.start} --> ${cue.end}`, body, '');
  }
  return out.join('\n');
}

/* ---------------- 单视频开关（播放器快捷按钮调用） ---------------- */

export interface VideoSubtitleState {
  /** 该视频当前是否有字幕在工作（track 双语 / TextTrack 会话 / ASR 会话） */
  active: boolean;
  /** 字幕来源：track = 站点字幕文件；text-track = 播放器灌 cues；asr = 语音识别 */
  source: 'track' | 'text-track' | 'asr' | 'none';
}

export function getVideoSubtitleState(video: HTMLVideoElement): VideoSubtitleState {
  if (hasAsrSession(video)) return { active: true, source: 'asr' };
  if (hasTrackCaptionSession(video)) return { active: true, source: 'text-track' };
  const rebuilt = [...video.querySelectorAll('track')].some(
    (t) => (t as HTMLTrackElement).dataset.imtRebuild === 'done',
  );
  if (rebuilt) return { active: true, source: 'track' };
  return { active: false, source: 'none' };
}

/** 打开该视频的字幕：真实 VTT 文件 → 重建；播放器灌 cues → TextTrack 会话；都没有 → ASR */
export async function enableVideoSubtitle(video: HTMLVideoElement, c: UserConfig): Promise<void> {
  config = c;
  // 1) 真实字幕文件（src 是 http/blob 且能解析出 cue）
  const fileTracks = ([...video.querySelectorAll('track')] as HTMLTrackElement[]).filter(
    (t) => t.src && !t.src.startsWith('data:'),
  );
  if (fileTracks.length > 0) {
    await Promise.all(fileTracks.map((t) => processTrack(t)));
    if (fileTracks.some((t) => t.dataset.imtRebuild === 'done')) return;
  }
  // 2) 播放器自己灌 cues（x.com 的 `data:,WEBVTT` 占位 + HLS SUBTITLES 轨属这一类）
  if (hasPlayerLoadedCaptions(video)) {
    const s = await startTrackCaptionSession(video, c);
    if (s) return;
  }
  // 3) 都没有 → 语音识别
  await startAsrSession(video, c);
}

/** 关闭该视频的字幕 */
export function disableVideoSubtitle(video: HTMLVideoElement): void {
  stopAsrSession(video);
  stopTrackCaptionSession(video);
  video.querySelectorAll('track').forEach((t) => restoreTrack(t as HTMLTrackElement));
  const textTracks = video.textTracks;
  for (let i = 0; i < textTracks.length; i++) {
    const t = textTracks[i];
    if (t.kind === 'subtitles' || t.kind === 'captions') {
      try {
        t.mode = 'disabled';
      } catch {
        /* 忽略 */
      }
    }
  }
}
