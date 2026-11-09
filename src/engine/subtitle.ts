import type { UserConfig } from '@/core/config/defaults';
import { normalizeText } from '@/core/shared/utils';
import { translateTexts } from './translator';
import { hasAsrSession, startAsrSession, stopAsrSession } from './asrSession';

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
}

export function disposeSubtitle(): void {
  observer?.disconnect();
  observer = null;
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

  track.dataset.imtRebuild = 'done';
  try {
    const res = await fetch(track.src);
    const vtt = await res.text();
    const cues = parseVtt(vtt);
    if (cues.length === 0) return;

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
  /** 该视频当前是否有字幕在工作（轨道双语 或 ASR 会话） */
  active: boolean;
  /** 字幕来源：track = 站点字幕轨；asr = 语音识别 */
  source: 'track' | 'asr' | 'none';
}

export function getVideoSubtitleState(video: HTMLVideoElement): VideoSubtitleState {
  if (hasAsrSession(video)) return { active: true, source: 'asr' };
  const rebuilt = [...video.querySelectorAll('track')].some(
    (t) => (t as HTMLTrackElement).dataset.imtRebuild === 'done',
  );
  if (rebuilt) return { active: true, source: 'track' };
  return { active: false, source: 'none' };
}

/** 打开该视频的字幕（有轨走轨道翻译，无轨走 ASR） */
export async function enableVideoSubtitle(video: HTMLVideoElement, c: UserConfig): Promise<void> {
  config = c;
  if (hasCaptionTrackIn(video)) {
    const tracks = [...video.querySelectorAll('track')] as HTMLTrackElement[];
    if (tracks.length > 0) {
      await Promise.all(tracks.map((t) => processTrack(t)));
      return;
    }
    // 播放器自建 TextTrack（无 <track> 元素）：显示原轨即可，双语需走 ASR 之外的通道（A4）
    const textTracks = video.textTracks;
    for (let i = 0; i < textTracks.length; i++) {
      const t = textTracks[i];
      if (t.kind === 'subtitles' || t.kind === 'captions') {
        try {
          t.mode = 'showing';
        } catch {
          /* 忽略 */
        }
      }
    }
    return;
  }
  await startAsrSession(video, c);
}

/** 关闭该视频的字幕 */
export function disableVideoSubtitle(video: HTMLVideoElement): void {
  stopAsrSession(video);
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
