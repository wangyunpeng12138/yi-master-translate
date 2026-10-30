<script setup lang="ts">
import { onMounted } from 'vue';
import { useConfigStore } from '@/core/config/ConfigStore';
import SettingRow from '@/components/SettingRow.vue';

const store = useConfigStore();

function openAiWrite() {
  void browser.tabs.create({ url: browser.runtime.getURL('/aiwrite.html') });
}

onMounted(() => store.load());
</script>

<template>
  <div>
    <h2 class="section-title">AI Write</h2>
    <el-alert
      title="AI Write 是独立的写作面板：输入任意文本，由自定义 AI 服务进行润色、改写或翻译。可通过快捷键 openAiWritingModal 呼出（在 chrome://extensions/shortcuts 绑定）"
      type="info" :closable="false" show-icon style="margin-bottom: 8px"
    />

    <SettingRow title="启用 AI Write" desc="开启后快捷键可呼出独立写作面板">
      <el-switch :model-value="store.config.ai.enabled" @update:model-value="store.patch({ ai: { enabled: $event } })" />
    </SettingRow>

    <SettingRow title="打开写作面板" desc="AI Write 由你配置的自定义 AI 服务驱动（见翻译服务分区）">
      <el-button type="primary" size="small" @click="openAiWrite">打开 AI Write</el-button>
    </SettingRow>

    <div class="write-intro">
      <h3>功能说明</h3>
      <ul>
        <li>润色 / 改写：将粗稿交给 AI 优化表达（需先配置自定义 AI 服务与 API Key）</li>
        <li>翻译写作：中文输入 → 英文输出，适合撰写外语邮件/issue</li>
        <li>与划词翻译、翻译服务共享同一套术语库与 AI 专家配置</li>
      </ul>
      <p class="note">注：原版 Gmail/GitHub 的 "AI Reply" 注入依赖站点专用适配，译大师以独立面板提供等价能力（Gmail/GitHub 注点不做）。</p>
    </div>
  </div>
</template>

<style scoped>
.section-title { margin-top: 0; }
.write-intro { margin-top: 20px; font-size: 13px; color: var(--el-text-color-secondary); line-height: 1.9; }
.write-intro h3 { font-size: 15px; margin: 0 0 6px; color: var(--el-text-color-primary); }
.write-intro ul { padding-left: 18px; }
.note { color: var(--el-color-warning); }
</style>
