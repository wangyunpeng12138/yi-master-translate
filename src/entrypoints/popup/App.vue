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
const pageStatus = ref<'idle' | 'translating' | 'done' | 'error'>('idle');
const currentTabId = ref<number | null>(null);

const experts = computed(() => store.config.ai.experts);
const hasCustomAi = computed(() => store.config.customServices.length > 0);

const statusText = computed(() =>
  pageStatus.value === 'translating'
    ? '翻译中…'
    : pageStatus.value === 'done'
      ? '已翻译，再次点击可切回原文'
      : pageStatus.value === 'error'
        ? '翻译失败，可重试'
        : '未翻译',
);

const btnText = computed(() =>
  pageStatus.value === 'translating'
    ? '停止翻译 (Alt+A)'
    : pageStatus.value === 'done'
      ? '显示原文 (Alt+A)'
      : '翻译 (Alt+A)',
);

onMounted(async () => {
  await store.load();
  // 当前活动页：仅该页的状态更新本 popup；状态直接向页面 content script 查询
  //（页面为权威源，导航/切 tab 后重新打开自动回显正确状态，不受 SW 生命周期影响）
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  currentTabId.value = tab?.id ?? null;
  if (tab?.id != null) {
    try {
      const r = (await browser.tabs.sendMessage(tab.id, { type: 'status:query' })) as {
        state?: typeof pageStatus.value;
      };
      pageStatus.value = r?.state ?? 'idle';
    } catch {
      pageStatus.value = 'idle'; // 无内容脚本的页面（chrome:// 等）
    }
  }
  browser.runtime.onMessage.addListener(
    (
      msg: { type?: string; payload?: { state?: typeof pageStatus.value } },
      sender: { tab?: { id?: number } },
    ) => {
      if (msg?.type !== 'translation:status') return;
      if (sender?.tab?.id != null && sender.tab.id !== currentTabId.value) return; // 其他页面的状态不串台
      pageStatus.value = msg.payload?.state ?? 'idle';
    },
  );
});

async function toggleTranslate() {
  const tabId = currentTabId.value;
  if (tabId == null) return;
  try {
    await browser.tabs.sendMessage(tabId, {
      type: 'command',
      payload: { command: 'toggleTranslatePage' },
    });
  } catch {
    pageStatus.value = 'error';
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
        <span class="brand">译大师</span>
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

      <!-- AI 精翻（无自定义 AI 服务时无实际效果，禁用并提示） -->
      <div class="ai-row" :title="hasCustomAi ? '' : '需先在「AI 服务」分区添加 AI 服务（API Key 或本地 Ollama）'">
        <span :class="{ 'ai-label-disabled': !hasCustomAi }">启用 AI 精翻</span>
        <el-switch
          size="small"
          :model-value="hasCustomAi ? store.config.ai.enabled : false"
          :disabled="!hasCustomAi"
          @update:model-value="store.patch({ ai: { enabled: $event } })"
        />
      </div>

      <!-- AI 搜索（与翻译服务分组独立；未配置 AI 服务时引导去设置页） -->
      <div class="ai-row">
        <span>AI 搜索</span>
        <div v-if="hasCustomAi" class="explain-picker">
          <ServicePicker
            :model-value="store.config.explain.service"
            allow-inherit ai-only
            style="width: 160px"
            @update:model-value="store.patch({ explain: { service: $event } })"
          />
        </div>
        <div v-else class="explain-empty">
          <span class="explain-hint">未配置 AI 服务</span>
          <el-button size="small" text type="primary" @click="openOptions('#ai_services')">去配置</el-button>
        </div>
      </div>

      <!-- 翻译主按钮：状态跟随页面（翻译中 loading / 已翻译变切回） -->
      <el-button
        type="primary"
        class="translate-btn"
        :loading="pageStatus === 'translating'"
        @click="toggleTranslate"
      >
        {{ btnText }}
      </el-button>
      <div class="status-line" :class="'status-' + pageStatus">{{ statusText }}</div>

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
.status-translating { color: #5470c6; }
.status-done { color: #1e9e6a; }
.status-error { color: var(--el-color-danger); }
.ai-label-disabled { color: var(--el-text-color-placeholder); }
.explain-empty {
  display: flex;
  align-items: center;
  gap: 4px;
}
.explain-hint {
  font-size: 12px;
  color: var(--el-text-color-placeholder);
}
.explain-picker :deep(.el-select__wrapper) {
  font-size: 12px;
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
