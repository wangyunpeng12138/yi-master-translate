import { describe, expect, it } from 'vitest';
import { detectTextLang, isSameTargetLang } from './utils';

describe('detectTextLang（段落语言启发式，对齐原版 locale-chinese 检测器）', () => {
  it('纯中文 → zh', () => {
    expect(detectTextLang('这是一段中文文本，用于测试语言检测功能')).toBe('zh');
  });

  it('纯英文 → auto（拉丁系不做段落级过滤）', () => {
    expect(detectTextLang('The quick brown fox jumps over the lazy dog')).toBe('auto');
  });

  it('中英混排且中文主导 → zh', () => {
    expect(detectTextLang('这是一个中文为主的段落，其中嵌入了一些 English words 引用')).toBe('zh');
  });

  it('中英混排且英文主导 → auto（照常翻译）', () => {
    expect(detectTextLang('This paragraph is mostly English with 中文 words embedded')).toBe('auto');
  });

  it('含假名 → ja（假名占比 > 0.1）', () => {
    expect(detectTextLang('この段落は日本語のテキストです')).toBe('ja');
  });

  it('含谚文 → ko', () => {
    expect(detectTextLang('이 단락은 한국어 텍스트입니다')).toBe('ko');
  });

  it('纯数字/符号 → auto', () => {
    expect(detectTextLang('123 456')).toBe('auto');
  });

  it('空文本 → auto', () => {
    expect(detectTextLang('')).toBe('auto');
  });
});

describe('isSameTargetLang（目标语言段落跳过判定）', () => {
  it('中文段落 + 目标 zh-CN → 跳过', () => {
    expect(isSameTargetLang('这是中文段落', 'zh-CN')).toBe(true);
  });

  it('中文段落 + 目标 zh-TW → 跳过（简繁同属汉字书写系统）', () => {
    expect(isSameTargetLang('這是繁體中文段落', 'zh-TW')).toBe(true);
  });

  it('英文段落 + 目标 zh-CN → 不跳过（需要翻译）', () => {
    expect(isSameTargetLang('Hello world, this is English', 'zh-CN')).toBe(false);
  });

  it('英文段落 + 目标 en → 不跳过（拉丁系无法可靠区分，保守不滤）', () => {
    expect(isSameTargetLang('Bonjour, ceci est du texte', 'en')).toBe(false);
  });

  it('日文段落 + 目标 ja → 跳过', () => {
    expect(isSameTargetLang('これは日本語です', 'ja')).toBe(true);
  });

  it('日文段落 + 目标 zh-CN → 不跳过（日→中需要翻译）', () => {
    expect(isSameTargetLang('これは日本語です', 'zh-CN')).toBe(false);
  });

  it('韩文段落 + 目标 ko → 跳过', () => {
    expect(isSameTargetLang('한국어 텍스트입니다', 'ko')).toBe(true);
  });
});
