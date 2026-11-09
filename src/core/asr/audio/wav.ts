/**
 * WAV 编码（16kHz / 单声道 / 16bit PCM）
 * 云 provider 与本地 whisper 都用这一份：44 字节标准 RIFF 头 + PCM 数据。
 */

export function floatTo16BitPCM(samples: Float32Array): Int16Array {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    // 限幅后量化；避免 ±1 溢出
    const s = Math.max(-1, Math.min(1, samples[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

/** Float32 PCM → WAV（小端，单声道） */
export function encodeWav(samples: Float32Array, sampleRate = 16_000): ArrayBuffer {
  const pcm = floatTo16BitPCM(samples);
  const dataSize = pcm.length * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true); // fmt 块长度
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // 单声道
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // 字节率 = 采样率 × 块对齐
  view.setUint16(32, 2, true); // 块对齐 = 声道数 × 位深/8
  view.setUint16(34, 16, true); // 位深
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);
  new Int16Array(buffer, 44).set(pcm);
  return buffer;
}

/** 解析 WAV 头，返回采样率/声道数/数据偏移（自检与联调用） */
export function parseWavHeader(buffer: ArrayBuffer): {
  ok: boolean;
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  dataOffset: number;
  dataSize: number;
} {
  const view = new DataView(buffer);
  const readStr = (offset: number, len: number) => {
    let s = '';
    for (let i = 0; i < len; i++) s += String.fromCharCode(view.getUint8(offset + i));
    return s;
  };
  const ok = buffer.byteLength > 44 && readStr(0, 4) === 'RIFF' && readStr(8, 4) === 'WAVE';
  return {
    ok,
    sampleRate: ok ? view.getUint32(24, true) : 0,
    channels: ok ? view.getUint16(22, true) : 0,
    bitsPerSample: ok ? view.getUint16(34, true) : 0,
    dataOffset: 44,
    dataSize: ok ? view.getUint32(40, true) : 0,
  };
}

/**
 * WAV(16bit PCM) → Float32Array（本地 Whisper 需要 [-1,1] 的浮点采样）
 * 多声道时按帧求均值降为单声道；非 16bit 直接报错（我们只产出 16k/16bit）。
 */
export function wavToFloat32(buffer: ArrayBuffer): { pcm: Float32Array; sampleRate: number } {
  const header = parseWavHeader(buffer);
  if (!header.ok) throw new Error('不是合法的 WAV 数据');
  if (header.bitsPerSample !== 16) {
    throw new Error(`仅支持 16bit PCM，当前为 ${header.bitsPerSample}bit`);
  }
  const channels = Math.max(1, header.channels);
  const dataSize = Math.min(header.dataSize, buffer.byteLength - header.dataOffset);
  const view = new DataView(buffer, header.dataOffset, dataSize - (dataSize % 2));
  const frames = Math.floor(dataSize / 2 / channels);
  const pcm = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let sum = 0;
    for (let c = 0; c < channels; c++) {
      sum += view.getInt16((i * channels + c) * 2, true) / 0x8000;
    }
    pcm[i] = sum / channels;
  }
  return { pcm, sampleRate: header.sampleRate };
}
