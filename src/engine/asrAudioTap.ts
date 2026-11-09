/**
 * 音频采集器（ASR 方案 §3.3 的 AudioTap）
 *
 * 路线：R1 — `MediaElementAudioSourceNode` 直采（A0 真机实测：x.com MSE 视频峰值 0.87，可用）
 * - 采样率直接向 AudioContext 要 16kHz，省掉手动重采样
 * - 必须把原声再接回 destination，否则视频会变静音
 * - 用 ScriptProcessorNode 而非 AudioWorklet：后者需要额外的 worklet 模块文件与
 *   web_accessible_resources 配置，A1 阶段先保证可用性（A3 再换 AudioWorklet）
 * - 同一个 <video> 只能被一个 AudioContext 捕获一次，用弱集合防重复
 */

const captured = new WeakSet<HTMLVideoElement>();

export interface AudioTapOptions {
  sampleRate?: number;
  bufferSize?: number;
  onPcm: (pcm: Float32Array) => void;
  onError?: (err: Error) => void;
}

export class AudioTap {
  private ctx: AudioContext | null = null;
  private source: MediaElementAudioSourceNode | null = null;
  private processor: ScriptProcessorNode | null = null;
  private sink: GainNode | null = null;
  private stopped = false;
  /** 已产出的样本总数（判定是否拿到有效信号） */
  private sampleCount = 0;
  private peak = 0;

  private constructor() {}

  get totalSamples(): number {
    return this.sampleCount;
  }

  /** 采集到的最大幅值；长期 ≈0 说明被 CORS 污染或音频静音 */
  get peakAmplitude(): number {
    return this.peak;
  }

  static async attach(video: HTMLVideoElement, opts: AudioTapOptions): Promise<AudioTap> {
    if (captured.has(video)) throw new Error('该视频已被采集（同一 video 不能绑定两个 AudioContext）');
    const rate = opts.sampleRate ?? 16_000;
    const tap = new AudioTap();
    const ctx = new AudioContext({ sampleRate: rate });
    // 注意：**不要 await resume()**。自动播放策略下处于 suspended 的 AudioContext，
    // resume() 的 Promise 可能长时间不 settle，会把整个会话卡在建图之前（实测踩过）。
    // 改为不阻塞 + 由上层在用户点击时再次 resume()。
    void ctx.resume().catch(() => undefined);
    const source = ctx.createMediaElementSource(video);
    const processor = ctx.createScriptProcessor(opts.bufferSize ?? 4096, 1, 1);
    // 静音汇点：processor 必须接到 destination 才会被驱动，但不能真的出声（原声由 source→destination 负责）
    const sink = ctx.createGain();
    sink.gain.value = 0;

    source.connect(ctx.destination); // 保住原声
    source.connect(processor);
    processor.connect(sink);
    sink.connect(ctx.destination);

    processor.onaudioprocess = (ev) => {
      if (tap.stopped) return;
      const input = ev.inputBuffer.getChannelData(0);
      let localPeak = 0;
      for (let i = 0; i < input.length; i++) {
        const a = input[i] < 0 ? -input[i] : input[i];
        if (a > localPeak) localPeak = a;
      }
      tap.peak = Math.max(tap.peak, localPeak);
      tap.sampleCount += input.length;
      // 必须复制：inputBuffer 的底层数组会被浏览器复用
      try {
        opts.onPcm(new Float32Array(input));
      } catch (e) {
        opts.onError?.(e as Error);
      }
    };

    tap.ctx = ctx;
    tap.source = source;
    tap.processor = processor;
    tap.sink = sink;
    captured.add(video);
    return tap;
  }

  /** 采样率（AudioContext 可能不支持 16k 而被浏览器改值，以实际为准） */
  get sampleRate(): number {
    return this.ctx?.sampleRate ?? 16_000;
  }

  /** 自动播放策略下 ctx 可能一直 suspended：由用户在页面上的点击来唤醒 */
  async resume(): Promise<void> {
    if (this.ctx?.state === 'suspended') await this.ctx.resume().catch(() => undefined);
  }

  get state(): AudioContextState | 'closed' {
    return this.ctx?.state ?? 'closed';
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    try {
      if (this.processor) {
        this.processor.onaudioprocess = null;
        this.processor.disconnect();
      }
      this.sink?.disconnect();
      this.source?.disconnect();
    } catch {
      /* 元素已销毁时忽略 */
    }
    void this.ctx?.close().catch(() => undefined);
    this.ctx = null;
  }
}

/** 该视频是否已被采集过（页面不刷新时，切视频要重新 attach） */
export function isVideoCaptured(video: HTMLVideoElement): boolean {
  return captured.has(video);
}
