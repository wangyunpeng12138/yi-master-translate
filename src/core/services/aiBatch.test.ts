import { describe, expect, it } from 'vitest';
import { buildAdapterOptions } from './aiBatch';
import { DEFAULT_CONFIG, type UserConfig } from '@/core/config/defaults';

describe('buildAdapterOptions（AI 提示词展开）', () => {
  const base: UserConfig = structuredClone(DEFAULT_CONFIG);

  it('ai.enabled 关闭时不注入专家与追加提示词', () => {
    const c: UserConfig = structuredClone(base);
    c.ai.enabled = false;
    c.ai.promptAppend = '领域定制要求';
    const opts = buildAdapterOptions(c, 'page');
    expect(opts.expertPrompt).toBeUndefined();
    expect(opts.promptAppend).toBeUndefined();
  });

  it('ai.enabled 开启且填写追加提示词时注入', () => {
    const c: UserConfig = structuredClone(base);
    c.ai.enabled = true;
    c.ai.promptAppend = '金融文本请使用中国市场惯用术语';
    const opts = buildAdapterOptions(c, 'page');
    expect(opts.promptAppend).toBe('金融文本请使用中国市场惯用术语');
  });

  it('空白追加提示词不注入（避免多余空行）', () => {
    const c: UserConfig = structuredClone(base);
    c.ai.enabled = true;
    c.ai.promptAppend = '   ';
    const opts = buildAdapterOptions(c, 'page');
    expect(opts.promptAppend).toBeUndefined();
  });

  it('激活专家时注入专家提示词', () => {
    const c: UserConfig = structuredClone(base);
    c.ai.enabled = true;
    c.ai.activeExpertId = 'tech';
    const opts = buildAdapterOptions(c, 'page');
    expect(opts.expertPrompt).toContain('technology');
  });
});
