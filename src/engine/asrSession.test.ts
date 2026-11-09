import { describe, expect, it } from 'vitest';
import { cleanRepeated } from './asrSession';

/**
 * Whisper 在静音/音乐段会「复读」——同一段词刷满整条字幕。
 * cleanRepeated 负责把连续重复的 n-gram 压成一份，过度复读则截断。
 */
describe('cleanRepeated（Whisper 复读抑制）', () => {
  it('短句原样返回（不做任何处理）', () => {
    expect(cleanRepeated('Hello world')).toBe('Hello world');
    expect(cleanRepeated('  spaced   text  ')).toBe('spaced   text');
  });

  it('压缩连续三连以上重复的短语', () => {
    const unit = 'who are in the world';
    const text = `I think ${Array(6).fill(unit).join(' ')}`;
    const out = cleanRepeated(text);
    expect(out.startsWith('I think who are in the world')).toBe(true);
    // 重复已被压缩：单元出现次数 ≤ 2
    const occurrences = out.split(unit).length - 1;
    expect(occurrences).toBeLessThanOrEqual(2);
    expect(out.length).toBeLessThan(text.length / 2);
  });

  it('正常句子里重复出现两次的词组不会被误伤', () => {
    const text = 'I really really want to say thank you to all of the fans today';
    expect(cleanRepeated(text)).toBe(text);
  });
});
