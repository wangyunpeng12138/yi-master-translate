import type { UserConfig } from '@/core/config/defaults';
import { normalizeText } from '@/core/shared/utils';
import { createCaptionLayer, type CaptionLayerHandle } from './captionLayer';
import { translateTexts } from './translator';

/**
 * TextTrack 字幕会话（X / YouTube 这类"播放器自己灌 cues"的站点）
 *
 * 为什么需要它：实测 x.com 有 CC 的视频，`<track>` 的 src 是 `data:,WEBVTT`（空占位），
 * 真正的字幕由播放器从 HLS 的 `#EXT-X-MEDIA:TYPE=SUBTITLES` 轨道加载进 `video.textTracks`。
 * 所以「抓 VTT 文件再重建」对这类站点无效，只能**读 TextTrack 的 cues**。
 *
 * 做法：
 * 1. 找到 subtitles/captions 轨，置 `mode='hidden'`（保留加载与 cuechange，但不让浏览器原生绘制）
 * 2. 若 cues 仍为空，模拟点一次站点自己的 CC 按钮把轨"叫醒"，再置回 hidden
 * 3. `cuechange` → 读全量 cues → 新文本批量翻译 → 复用浮层按时间轴渲染
 */

interface CueItem {
  start: number;
  end: number;
  text: string;
  translation: string;
  state: 'pending' | 'translated' | 'error';
}

export interface TrackCaptionSession {
  stop(): void;
  readonly kind: 'text-track';
}

const sessions = new WeakMap<HTMLVideoElement, TrackCaptionSession>();

function pickTrack(video: HTMLVideoElement, targetLang: string): TextTrack | null {
  const tracks: TextTrack[] = [];
  for (let i = 0; i < video.textTracks.length; i++) tracks.push(video.textTracks[i]);
  const subs = tracks.filter((t) => t.kind === 'subtitles' || t.kind === 'captions');
  if (subs.length === 0) return null;
  // 优先挑非目标语言（目标语言字幕无需翻译，交给站点原生显示）
  const t = targetLang.split('-')[0].toLowerCase();
  return subs.find((s) => !(s.language || '').toLowerCase().startsWith(t)) ?? subs[0];
}

/** 找站点自己的 CC 开关按钮（x.com: aria「显示字幕/隐藏字幕」，图标 icon-closed-caption-*） */
function findNativeCcButton(video: HTMLVideoElement): HTMLElement | null {
  const root = (video.parentElement?.parentElement ?? video.parentElement ?? document.body) as HTMLElement;
  const selectors = [
    'button[aria-label*="字幕"]',
    'button[aria-label*="Captions" i]',
    'button[aria-label*="Subtitles" i]',
    'button[data-testid="captions"]',
    'button:has(svg[data-icon*="closed-caption"])',
  ];
  for (const sel of selectors) {
    try {
      const el = root.querySelector(sel);
      if (el) return el as HTMLElement;
    } catch {
      /* :has 等不支持时忽略 */
    }
  }
  return null;
}

function readCues(track: TextTrack): Array<{ start: number; end: number; text: string }> {
  const out: Array<{ start: number; end: number; text: string }> = [];
  const list = track.cues;
  if (!list) return out;
  for (let i = 0; i < list.length; i++) {
    const c = list[i] as VTTCue;
    const text = normalizeText((c.text || '').replace(/<[^>]+>/g, ''));
    if (!text) continue;
    out.push({ start: c.startTime, end: c.endTime, text });
  }
  return out;
}

/** 确保轨道里有 cues：X 这类播放器只要把 mode 从 disabled 改成 hidden 就会开始灌 cues（实测 1s 内到位） */
async function ensureCuesReady(video: HTMLVideoElement, track: TextTrack): Promise<boolean> {
  const hasCues = () => !!track.cues && track.cues.length > 0;
  try {
    track.mode = 'hidden';
  } catch {
    /* 某些浏览器要求先 showing 再 hidden */
  }
  for (let i = 0; i < 6; i++) {
    if (hasCues()) return true;
    await new Promise((r) => setTimeout(r, 400));
  }

  // 兜底：还没来就模拟点一次站点自己的 CC 按钮（会把站点 CC 状态点亮，所以只作最后手段）
  const nativeBtn = findNativeCcButton(video);
  if (nativeBtn) {
    nativeBtn.click();
    await new Promise((r) => setTimeout(r, 500));
    try {
      track.mode = 'hidden';
    } catch {
      /* 忽略 */
    }
    for (let i = 0; i < 6; i++) {
      if (hasCues()) return true;
      await new Promise((r) => setTimeout(r, 400));
    }
  }
  return hasCues();
}

export async function startTrackCaptionSession(
  video: HTMLVideoElement,
  config: UserConfig,
): Promise<TrackCaptionSession | null> {
  if (sessions.has(video)) return sessions.get(video) ?? null;
  const track = pickTrack(video, config.general.targetLanguage);
  if (!track) {
    console.info('[imt-rebuild] TextTrack 会话跳过：没有 subtitles/captions 轨');
    return null;
  }
  console.info(`[imt-rebuild] TextTrack 会话启动：${track.label || track.kind} (mode=${track.mode})`);

  const items: CueItem[] = [];
  const known = new Set<string>();
  let stopped = false;
  let rafId = 0;
  let lastShown = '';
  let translating = false;
  let layer: CaptionLayerHandle | null = null;
  let keepAlive: number | undefined;
  const cleanups: Array<() => void> = [];
  const originalMode = track.mode;

  /** 立即占位：ensureCuesReady 有 await，不先登记会被巡检/事件重复拉起（实测重复 4 个会话） */
  const stop = () => {
    if (stopped) return;
    stopped = true;
    console.info('[imt-rebuild] TextTrack 会话停止');
    if (rafId) cancelAnimationFrame(rafId);
    if (keepAlive) window.clearInterval(keepAlive);
    cleanups.forEach((fn) => {
      try {
        fn();
      } catch {
        /* 忽略 */
      }
    });
    layer?.destroy();
    sessions.delete(video);
  };
  const handle: TrackCaptionSession = { stop, kind: 'text-track' };
  sessions.set(video, handle);

  const render = () => {
    if (stopped) return;
    rafId = requestAnimationFrame(render);
    if (!layer) return;
    const t = video.currentTime;
    const active = items.filter((it) => t >= it.start && t <= it.end);
    if (active.length === 0) {
      if (lastShown !== '') {
        lastShown = '';
        layer.hide();
      }
      return;
    }
    const source = active.map((a) => a.text).join(' ');
    const target = active.map((a) => a.translation).filter(Boolean).join(' ');
    const key = `${source}|${target}`;
    if (key === lastShown) return;
    lastShown = key;
    layer.setStatus(null);
    if (config.subtitle.displayMode === 'only') layer.show('', target || source);
    else layer.show(source, target);
    if (active.some((a) => a.state === 'pending')) layer.setStatus('翻译中…');
  };

  /** 读 cues → 新文本入队 → 翻译 */
  const sync = async () => {
    if (stopped) return;
    const cues = readCues(track);
    const fresh: CueItem[] = [];
    for (const c of cues) {
      if (known.has(c.text)) continue;
      known.add(c.text);
      const item: CueItem = { ...c, translation: '', state: 'pending' };
      items.push(item);
      fresh.push(item);
    }
    items.sort((a, b) => a.start - b.start);
    if (fresh.length === 0 || translating) return;

    translating = true;
    const BATCH = 8;
    try {
      for (let i = 0; i < fresh.length; i += BATCH) {
        if (stopped) break;
        const slice = fresh.slice(i, i + BATCH);
        try {
          const out = await translateTexts(
            slice.map((s) => s.text),
            'auto',
            config.general.targetLanguage,
            config.subtitle.service,
            'subtitle',
          );
          slice.forEach((it, j) => {
            it.translation = (out[j] ?? '').trim();
            it.state = it.translation ? 'translated' : 'error';
          });
        } catch (e) {
          slice.forEach((it) => (it.state = 'error'));
          console.warn('[imt-rebuild] 字幕翻译失败：', e);
        }
      }
    } finally {
      translating = false;
    }
  };

  layer = createCaptionLayer(video, { translationPosition: config.subtitle.translationPosition });

  const onCueChange = () => void sync();
  track.addEventListener('cuechange', onCueChange);
  const videoTracks = video.textTracks;
  videoTracks.addEventListener?.('addtrack', onCueChange);
  cleanups.push(() => track.removeEventListener('cuechange', onCueChange));
  cleanups.push(() => videoTracks.removeEventListener?.('addtrack', onCueChange));
  cleanups.push(() => {
    try {
      track.mode = originalMode === 'showing' ? 'disabled' : originalMode;
    } catch {
      /* 忽略 */
    }
  });

  // 站点重渲染会把 track.mode 重置回 disabled（实测：会话还活着但轨被关掉、cues 归零），
  // 这里低频重申一次目标状态。
  keepAlive = window.setInterval(() => {
    if (stopped) return;
    if (track.mode === 'disabled') {
      try {
        track.mode = 'hidden';
        void sync();
      } catch {
        /* 忽略 */
      }
    }
  }, 2000);

  const ready = await ensureCuesReady(video, track);
  console.info(`[imt-rebuild] TextTrack cues 就绪=${ready}，数量=${track.cues?.length ?? 0}`);
  if (stopped) return null;
  if (!ready) {
    layer.setStatus('未取到字幕轨（该视频可能没有字幕）');
    stop();
    return null;
  }
  await sync();
  if (stopped) return null;
  rafId = requestAnimationFrame(render);
  return handle;
}

export function hasTrackCaptionSession(video: HTMLVideoElement): boolean {
  return sessions.has(video);
}

export function stopTrackCaptionSession(video: HTMLVideoElement): void {
  sessions.get(video)?.stop();
  sessions.delete(video);
}

/** 该视频是否存在"播放器灌 cues"的字幕轨（有 <track> 但 src 是空占位也算） */
export function hasPlayerLoadedCaptions(video: HTMLVideoElement): boolean {
  for (let i = 0; i < video.textTracks.length; i++) {
    const t = video.textTracks[i];
    if (t.kind === 'subtitles' || t.kind === 'captions') return true;
  }
  return false;
}
