import { describe, expect, it } from 'vitest';
import { deepMerge, diffPatch } from './merge';

describe('deepMerge', () => {
  it('对象递归合并，保留未触及的键', () => {
    const base = { a: { x: 1, y: 2 }, b: [1, 2] };
    const out = deepMerge(base, { a: { x: 9 } });
    expect(out.a).toEqual({ x: 9, y: 2 });
    expect(out.b).toEqual([1, 2]);
  });

  it('patch 数组整体覆盖（原版 .add/.remove 语义简化）', () => {
    const out = deepMerge({ list: ['a'] }, { list: ['b', 'c'] });
    expect(out.list).toEqual(['b', 'c']);
  });

  it('null 删除键', () => {
    const out = deepMerge({ a: 1, b: 2 }, { b: null });
    expect(out).toEqual({ a: 1 });
  });

  it('基础类型直接替换', () => {
    expect(deepMerge({ a: 1 }, { a: 'x' }).a).toBe('x');
  });

  it('不修改原对象（浅 clone 安全）', () => {
    const base = { a: { x: 1 } };
    deepMerge(base, { a: { x: 2 } });
    expect(base.a.x).toBe(1);
  });
});

describe('diffPatch', () => {
  it('提取与默认值的差集（用于导出精简配置）', () => {
    const defaults = { general: { service: 'bing', mode: 'dual' }, engine: { deep: true } };
    const merged = { general: { service: 'google', mode: 'dual' }, engine: { deep: true } };
    expect(diffPatch(defaults, merged)).toEqual({ general: { service: 'google' } });
  });
});
