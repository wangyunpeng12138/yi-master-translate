<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useConfigStore } from '@/core/config/ConfigStore';

/**
 * 「更多功能」菜单（对齐原版 11 项）
 * P4 版：站点翻译设置 / 译文偏好 / 强制全译 / 悬浮球 / 侧边导航 / 缓存管理 / 侧边栏 / 翻译到底部
 *       / 术语库设置 / 自定义网站设置（临时译文编辑 P6 接入）
 */

const props = defineProps<{ modelValue: boolean }>();
const emit = defineEmits<{ 'update:modelValue': [v: boolean] }>();

const store = useConfigStore();
const host = ref('');
const cacheCount = ref<number | null>(null);

const siteMode = computed(() => store.config.sites[host.value]?.translateMode ?? 'global');

async function loadTabInfo() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  try {
    host.value = new URL(tab.url ?? '').hostname;
  } catch {
    host.value = '';
  }
  await refreshCache();
}

async function refreshCache() {
  const all = (await browser.storage.local.get(null)) as Record<string, unknown>;
  cacheCount.value = Object.keys(all).filter((k) => k.startsWith('cache:')).length;
}

async function setSiteMode(mode: 'global' | 'always' | 'never') {
  if (!host.value) return;
  const sites = { ...store.config.sites };
  if (mode === 'global') delete sites[host.value];
  else sites[host.value] = { ...(sites[host.value] ?? {}), translateMode: mode };
  await store.patch({ sites });
}

async function clearCache() {
  const all = (await browser.storage.local.get(null)) as Record<string, unknown>;
  const cacheKeys = Object.keys(all).filter((k) => k.startsWith('cache:'));
  if (cacheKeys.length > 0) await browser.storage.local.remove(cacheKeys);
  await refreshCache();
}

async function openSidePanel() {
  try {
    const win = await browser.windows.getCurrent();
    if (win.id === undefined) return;
    await browser.sidePanel.open({ windowId: win.id });
  } catch {
    // 不支持 sidePanel.open 的版本静默
  }
  emit('update:modelValue', false);
}

async function translateToPageEnd() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) {
    await browser.tabs
      .sendMessage(tab.id, {
        type: 'command',
        payload: { command: 'toggleTranslateTheWholePage' },
      })
      .catch(() => undefined);
  }
  emit('update:modelValue', false);
}

function goOptions(hash: string) {
  void browser.tabs.create({ url: browser.runtime.getURL(`/options.html${hash}`) });
  emit('update:modelValue', false);
}

onMounted(async () => {
  await store.load();
  await loadTabInfo();
});
</script>

<template>
  <el-drawer
    :model-value="props.modelValue"
    direction="btt"
    size="66%"
    :with-header="false"
    :append-to-body="false"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div class="more-menu">
      <!-- 当前网站翻译设置 -->
      <div class="menu-section">
        <div class="menu-title">当前网站翻译设置<el-tag v-if="host" size="small">{{ host }}</el-tag></div>
        <el-radio-group :model-value="siteMode" size="small" @update:model-value="setSiteMode($event as never)">
          <el-radio-button value="global" label="跟随全局" />
          <el-radio-button value="always" label="自动翻译" />
          <el-radio-button value="never" label="不自动翻译" />
        </el-radio-group>
      </div>

      <!-- 译文偏好 -->
      <div class="menu-section">
        <div class="menu-title">译文偏好</div>
        <el-radio-group
          :model-value="store.config.general.displayMode"
          size="small"
          @update:model-value="store.patch({ general: { displayMode: $event } })"
        >
          <el-radio-button value="dual" label="双语对照" />
          <el-radio-button value="only" label="仅译文" />
        </el-radio-group>
      </div>

      <!-- 开关组 -->
      <div class="menu-section switches">
        <div class="switch-row">
          <span>强制翻译所有内容</span>
          <el-switch :model-value="store.config.engine.translateWholePage" @update:model-value="store.patch({ engine: { translateWholePage: $event } })" />
        </div>
        <div class="switch-row">
          <span>开启悬浮球</span>
          <el-switch :model-value="store.config.floatball.enabled" @update:model-value="store.patch({ floatball: { enabled: $event } })" />
        </div>
        <div class="switch-row">
          <span>直接翻译网页侧边导航</span>
          <el-switch :model-value="store.config.engine.translateSidebar" @update:model-value="store.patch({ engine: { translateSidebar: $event } })" />
        </div>
      </div>

      <!-- 缓存 -->
      <div class="menu-section switch-row">
        <span>翻译缓存（{{ cacheCount ?? '…' }} 条）</span>
        <div>
          <el-switch :model-value="store.config.cache.enabled" size="small" @update:model-value="store.patch({ cache: { enabled: $event } })" />
          <el-button size="small" text type="danger" style="margin-left: 8px" @click="clearCache">清除缓存</el-button>
        </div>
      </div>

      <!-- 动作按钮 -->
      <div class="menu-actions">
        <el-button size="small" @click="openSidePanel">开启侧边栏</el-button>
        <el-button size="small" @click="translateToPageEnd">立即翻译到页面底部</el-button>
        <el-button size="small" @click="goOptions('#terms')">AI 术语库设置</el-button>
        <el-button size="small" @click="goOptions('#developer')">自定义网站设置</el-button>
      </div>
    </div>
  </el-drawer>
</template>

<style scoped>
.more-menu {
  padding: 4px;
}
.menu-section {
  padding: 10px 0;
  border-bottom: 1px solid var(--el-border-color-lighter);
}
.menu-title {
  font-size: 13px;
  color: var(--el-text-color-secondary);
  margin-bottom: 8px;
  display: flex;
  gap: 8px;
  align-items: center;
}
.switch-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 0;
  font-size: 14px;
}
.menu-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding-top: 12px;
}
</style>
