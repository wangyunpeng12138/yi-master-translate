<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import zhCn from 'element-plus/es/locale/lang/zh-cn';
import { useConfigStore } from '@/core/config/ConfigStore';
import LangPicker from '@/components/LangPicker.vue';
import ServicePicker from '@/components/ServicePicker.vue';
import MoreMenu from './MoreMenu.vue';

/**
 * 工具栏 Popup（P4，对齐原版结构）
 * 顶部语言对 → 服务/AI 专家 → 翻译主按钮 → 快捷入口 → 底部设置/更多功能
 */

const store = useConfigStore();
const version = browser.runtime.getManifest().version;
const moreOpen = ref(false);
const translating = ref(false);
const pageStatus = ref<'idle' | 'translating' | 'done' | 'error'>('idle');

const experts = computed(() => store.config.ai.experts);

const statusText = computed(() =>
  pageStatus.value === 'translating'
    ? '翻译中…'
    : pageStatus.value === 'done'
      ? '已翻译，再次点击可切回原文'
      : pageStatus.value === 'error'
        ? '翻译失败'
        : '',
);

onMounted(async () => {
  await store.load();
  // 状态回显（与 background badge 同源事件）
  browser.runtime.onMessage.addListener((msg: { type?: string; payload?: { state?: typeof pageStatus.value } }) => {
    if (msg?.type === 'translation:status') pageStatus.value = msg.payload?.state ?? 'idle';
  });
});

async function toggleTranslate() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  translating.value = true;
  try {
    await browser.tabs.sendMessage(tab.id, {
      type: 'command',
      payload: { command: 'toggleTranslatePage' },
    });
  } catch {
    pageStatus.value = 'error';
  } finally {
    translating.value = false;
  }
}

function openOptions(hash: string) {
  void browser.tabs.create({ url: browser.runtime.getURL(`/options.html${hash}`) });
}
</script>

<template>
  <el-config-provider :locale="zhCn">
    <div class="popup-shell">
      <!-- 顶部 -->
      <div class="popup-header">
        <span class="brand">沉浸式翻译（复刻版）</span>
        <el-tag size="small" type="info">v{{ version }}</el-tag>
      </div>

      <!-- 语言对 -->
      <div class="lang-row">
        <div class="lang-fixed">自动检测</div>
        <span class="arrow">→</span>
        <LangPicker
          :model-value="store.config.general.targetLanguage"
          style="flex: 1; width: auto"
          @update:model-value="store.patch({ general: { targetLanguage: $event } })"
        />
      </div>

      <!-- 服务与专家 -->
      <div class="service-row">
        <ServicePicker
          :model-value="store.config.general.service"
          style="flex: 1; width: auto"
          @update:model-value="store.patch({ general: { service: $event } })"
        />
        <el-select
          :model-value="store.config.ai.activeExpertId"
          style="width: 118px"
          :disabled="!store.config.ai.enabled"
          @update:model-value="store.patch({ ai: { activeExpertId: $event } })"
        >
          <el-option v-for="e in experts" :key="e.id" :value="e.id" :label="e.name" />
        </el-select>
      </div>

      <!-- AI 精翻 -->
      <div class="ai-row">
        <span>启用 AI 精翻</span>
        <el-switch
          size="small"
          :model-value="store.config.ai.enabled"
          @update:model-value="store.patch({ ai: { enabled: $event } })"
        />
      </div>

      <!-- 翻译主按钮 -->
      <el-button type="primary" class="translate-btn" :loading="translating" @click="toggleTranslate">
        翻译 (Alt+A)
      </el-button>
      <div v-if="statusText" class="status-line">{{ statusText }}</div>

      <!-- 快捷入口 -->
      <div class="quick-row">
        <div class="quick-item" @click="openOptions('#preview')">
          <span class="q-icon">📄</span>
          <span>文档</span>
        </div>
        <div class="quick-item" @click="openOptions('#preview')">
          <span class="q-icon">💬</span>
          <span>文本</span>
        </div>
        <div class="quick-item" @click="openOptions('#mouse_hover')">
          <span class="q-icon">🖱️</span>
          <span>悬停</span>
        </div>
        <div class="quick-item" @click="openOptions('#selection_translation')">
          <span class="q-icon">✂️</span>
          <span>划词</span>
        </div>
      </div>

      <!-- 底部 -->
      <div class="popup-footer">
        <el-button text size="small" @click="openOptions('#general')">设置</el-button>
        <el-button text size="small" @click="openOptions('#about')">V {{ version }}</el-button>
        <el-button text size="small" type="primary" @click="moreOpen = true">更多功能</el-button>
      </div>

      <MoreMenu v-model="moreOpen" />
    </div>
  </el-config-provider>
</template>

<style scoped>
.popup-shell {
  width: 340px;
  padding: 12px;
}
.popup-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}
.brand {
  font-weight: 600;
}
.lang-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.lang-fixed {
  flex: 1;
  padding: 4px 8px;
  border: 1px solid var(--el-border-color);
  border-radius: 4px;
  font-size: 13px;
  color: var(--el-text-color-secondary);
  background: var(--el-fill-color-lighter);
}
.arrow {
  color: var(--el-text-color-secondary);
}
.service-row {
  display: flex;
  gap: 8px;
  margin-bottom: 8px;
}
.ai-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 13px;
  margin-bottom: 10px;
}
.translate-btn {
  width: 100%;
}
.status-line {
  text-align: center;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  margin-top: 6px;
}
.quick-row {
  display: flex;
  justify-content: space-around;
  margin: 14px 0 6px;
}
.quick-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--el-text-color-regular);
  cursor: pointer;
  padding: 6px 10px;
  border-radius: 6px;
}
.quick-item:hover {
  background: var(--el-fill-color-light);
}
.q-icon {
  font-size: 16px;
}
.popup-footer {
  display: flex;
  justify-content: space-between;
  border-top: 1px solid var(--el-border-color-lighter);
  padding-top: 6px;
}
</style>
