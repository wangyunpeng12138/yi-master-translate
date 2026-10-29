/**
 * content 侧翻译客户端：批量分块 → background translate:batch → 保序合并
 * （翻译出网与缓存均在 background，content 只做消息编排）
 */

const CHUNK = 24; // 单次消息最多段落数

export async function translateTexts(
  texts: string[],
  from: string,
  to: string,
  service: string,
  scope: 'page' | 'subtitle' | 'input' | 'selection' | 'hover' | 'text' = 'page',
): Promise<string[]> {
  const out: string[] = [];
  for (let i = 0; i < texts.length; i += CHUNK) {
    const chunk = texts.slice(i, i + CHUNK);
    const res = (await browser.runtime.sendMessage({
      type: 'translate:batch',
      payload: { texts: chunk, from, to, service, scope },
    })) as { texts?: string[] };
    if (!res?.texts || res.texts.length !== chunk.length) {
      throw new Error('translate:batch response mismatch');
    }
    out.push(...res.texts);
  }
  return out;
}
