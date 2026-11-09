import { describe, expect, it } from 'vitest';
import { encodeWav, floatTo16BitPCM, parseWavHeader } from './wav';

describe('wav 编码', () => {
  it('写入合法 RIFF/WAVE 头且参数为 16k/单声道/16bit', () => {
    const pcm = new Float32Array(1600); // 0.1s @16k
    const buf = encodeWav(pcm, 16_000);
    const h = parseWavHeader(buf);
    expect(h.ok).toBe(true);
    expect(h.sampleRate).toBe(16_000);
    expect(h.channels).toBe(1);
    expect(h.bitsPerSample).toBe(16);
    expect(buf.byteLength).toBe(44 + pcm.length * 2);
    expect(h.dataSize).toBe(pcm.length * 2);
  });

  it('float → int16 限幅，避免 +1 溢出成负值', () => {
    const out = floatTo16BitPCM(new Float32Array([1.5, -1.5, 0, 0.5]));
    expect(out[0]).toBe(0x7fff);
    expect(out[1]).toBe(-0x8000);
    expect(out[2]).toBe(0);
    expect(out[3]).toBeGreaterThan(0);
  });

  it('采样率参数影响头部字节率', () => {
    const buf = encodeWav(new Float32Array(10), 8_000);
    const view = new DataView(buf);
    expect(view.getUint32(28, true)).toBe(8_000 * 2); // 字节率
    expect(view.getUint16(32, true)).toBe(2); // 块对齐
  });
});
