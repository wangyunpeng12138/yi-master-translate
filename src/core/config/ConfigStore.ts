import { defineStore } from 'pinia';
import { DEFAULT_CONFIG, type UserConfig } from './defaults';
import type { DeepPartial } from './merge';
import {
  loadUserConfig,
  onUserConfigChanged,
  resetUserConfig,
  saveUserConfig,
} from './storage';

/**
 * 配置 Store（UI 上下文专用：popup / options / sidepanel）
 * - load(): 读三层合并结果
 * - patch(): 写入用户层并同步 storage（多窗口经 storage 事件自动联动）
 */
export const useConfigStore = defineStore('config', {
  state: () => ({
    config: structuredClone(DEFAULT_CONFIG) as UserConfig,
    loaded: false,
  }),
  getters: {
    targetLanguage: (s) => s.config.general.targetLanguage,
    defaultService: (s) => s.config.general.service,
  },
  actions: {
    async load() {
      this.config = await loadUserConfig();
      this.loaded = true;
    },
    async patch(p: DeepPartial<UserConfig>) {
      this.config = await saveUserConfig(p);
    },
    async reset() {
      await resetUserConfig();
      this.config = structuredClone(DEFAULT_CONFIG);
    },
    /** 绑定 storage 变化（其他窗口/页面修改时保持同步），返回解绑函数 */
    bindSync(): () => void {
      return onUserConfigChanged((cfg) => {
        this.config = cfg;
      });
    },
  },
});
