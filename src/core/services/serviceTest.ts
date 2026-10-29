/**
 * 服务连通性测试（设置页各分区共用）
 */
import type { useConfigStore } from '@/core/config/ConfigStore';

type Store = ReturnType<typeof useConfigStore>;

export async function runServiceTest(store: Store, section: string): Promise<string | null> {
  const serviceId =
    section === 'general' ? store.config.general.service : section === 'input' ? store.config.inputbox.service : section;
  try {
    const res = (await browser.runtime.sendMessage({
      type: 'translate:batch',
      payload: {
        texts: ['Hello world, this is a service connectivity test.'],
        from: 'auto',
        to: store.config.general.targetLanguage,
        service: serviceId === 'inherit' ? store.config.general.service : serviceId,
        scope: 'text',
      },
    })) as { texts?: string[] };
    return res?.texts?.[0] ?? null;
  } catch (e) {
    throw e instanceof Error ? e : new Error(String(e));
  }
}
