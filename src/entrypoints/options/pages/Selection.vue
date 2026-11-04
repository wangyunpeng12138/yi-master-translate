<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useConfigStore } from '@/core/config/ConfigStore';
import SettingRow from '@/components/SettingRow.vue';
import ServicePicker from '@/components/ServicePicker.vue';

const store = useConfigStore();
const newBlocked = ref('');

async function addBlocked() {
  const v = newBlocked.value.trim();
  if (!v) return;
  await store.patch({ selection: { blockUrls: [...store.config.selection.blockUrls, v] } });
  newBlocked.value = '';
}

async function removeBlocked(i: number) {
  await store.patch({ selection: { blockUrls: store.config.selection.blockUrls.filter((_, x) => x !== i) } });
}

onMounted(() => store.load());
</script>

<template>
  <div>
    <h2 class="section-title">划词翻译</h2>
    <el-alert
      title="划词翻译基于 AI 大模型实现（选中文本直接发送给大模型），因此仅支持 AI 类翻译服务。原版配置默认关闭，请手动开启。"
      type="info" :closable="false" show-icon style="margin-bottom: 8px"
    />

    <SettingRow title="启用划词翻译" desc="选中文字后显示触发按钮，点击翻译">
      <el-switch :model-value="store.config.selection.enabled" @update:model-value="store.patch({ selection: { enabled: $event } })" />
    </SettingRow>

    <SettingRow title="划词翻译触发方式" desc="原版默认为显示小圆点（mini）">
      <el-select
        :model-value="store.config.selection.triggerStyle"
        style="width: 220px"
        @update:model-value="store.patch({ selection: { triggerStyle: $event } })"
      >
        <el-option value="icon" label="选中文本后显示图标" />
        <el-option value="dot" label="显示小圆点" />
      </el-select>
    </SettingRow>

    <SettingRow title="启用圈选翻译" desc="按住快捷键圈选页面区域，识别并翻译图片或不可选中文本（截图 OCR）">
      <el-switch :model-value="store.config.selection.circleSelectEnabled" @update:model-value="store.patch({ selection: { circleSelectEnabled: $event } })" />
    </SettingRow>

    <SettingRow title="圈选翻译快捷键" desc="按住该键即可圈选（默认 Z）">
      <el-input
        :model-value="store.config.selection.circleSelectKey"
        style="width: 100px"
        @update:model-value="store.patch({ selection: { circleSelectKey: ($event as string).toLowerCase() } })"
      />
    </SettingRow>

    <SettingRow title="翻译服务" desc="划词翻译专用服务（仅 AI 类；默认跟随全局翻译服务）">
      <ServicePicker
        :model-value="store.config.selection.service"
        allow-inherit ai-only
        @update:model-value="store.patch({ selection: { service: $event } })"
      />
    </SettingRow>

    <h3>划词 AI 搜索</h3>
    <el-alert
      title="选中文字后额外显示蓝色 AI 搜索按钮：点击后由 AI 解读选中文字的含义、语境与背景，生成中文解释弹窗"
      type="info" :closable="false" show-icon style="margin-bottom: 8px"
    />

    <SettingRow title="启用划词 AI 搜索" desc="选中文字后显示蓝色 AI 搜索按钮（与翻译按钮并存）">
      <el-switch :model-value="store.config.selection.aiSearchEnabled" @update:model-value="store.patch({ selection: { aiSearchEnabled: $event } })" />
    </SettingRow>

    <SettingRow title="AI 搜索服务" desc="划词解释专用 AI 服务（默认跟随 AI 搜索/全局翻译服务）">
      <ServicePicker
        :model-value="store.config.selection.aiSearchService"
        allow-inherit ai-only
        @update:model-value="store.patch({ selection: { aiSearchService: $event } })"
      />
    </SettingRow>

    <SettingRow title="启用单词自动朗读" desc="划词后自动发音">
      <el-switch :model-value="store.config.selection.autoSpeakWord" @update:model-value="store.patch({ selection: { autoSpeakWord: $event } })" />
    </SettingRow>

    <SettingRow title="目标语言与原语言相同时" desc="同语言时的行为策略">
      <el-select
        :model-value="store.config.selection.sameLangBehavior"
        style="width: 200px"
        @update:model-value="store.patch({ selection: { sameLangBehavior: $event } })"
      >
        <el-option value="translate" label="开启划词翻译" />
        <el-option value="skip" label="跳过" />
      </el-select>
    </SettingRow>

    <h3>划词翻译禁用网站</h3>
    <div v-for="(u, i) in store.config.selection.blockUrls" :key="u + i" class="blocked-row">
      <code>{{ u }}</code>
      <el-button size="small" text type="danger" @click="removeBlocked(i)">删除</el-button>
    </div>
    <div class="add-row">
      <el-input v-model="newBlocked" placeholder="*://example.com/*" style="width: 300px" size="small" />
      <el-button size="small" @click="addBlocked">添加</el-button>
    </div>
  </div>
</template>

<style scoped>
.section-title { margin-top: 0; }
h3 { font-size: 15px; margin: 18px 0 8px; }
.blocked-row {
  display: flex; justify-content: space-between; align-items: center;
  padding: 6px 4px; border-bottom: 1px solid var(--el-border-color-lighter);
}
.add-row { display: flex; gap: 8px; margin-top: 10px; }
</style>
