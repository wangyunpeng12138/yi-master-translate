import type { UserConfig } from '@/core/config/defaults';
import { normalizeText } from '@/core/shared/utils';
import { translateTexts } from './translator';

/**
 * 视频字幕引擎（P8a 基础版：track 拦截方案）
 * 流程：扫描页面 <video> 的 <track> → fetch vtt → 解析 cue → 批量翻译 →
 *       重建双语 vtt（原文\n译文 / 仅译文）→ blob URL 替换 → showing
 * 范围：仅已有字幕轨的视频；无字幕 ASR 已裁剪（见实现方案 §1.2）。
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
    track.src = url;
    // 展示翻译后的轨道
    requestAnimationFrame(() => {
      try {
        track.track.mode = 'showing';
      } catch { /* track 未加载完成时忽略 */ }
    });
  } catch (e) {
    console.warn('[imt-rebuild] subtitle translate failed:', e);
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
