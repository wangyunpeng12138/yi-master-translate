<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useConfigStore } from '@/core/config/ConfigStore';
import SettingRow from '@/components/SettingRow.vue';

const store = useConfigStore();
const newBlocked = ref('');

async function addBlocked() {
  const v = newBlocked.value.trim();
  if (!v) return;
  await store.patch({ floatball: { blockUrls: [...store.config.floatball.blockUrls, v] } });
  newBlocked.value = '';
}

async function removeBlocked(i: number) {
  await store.patch({ floatball: { blockUrls: store.config.floatball.blockUrls.filter((_, x) => x !== i) } });
}

onMounted(() => store.load());
</script>

<template>
  <div>
    <h2 class="section-title">悬浮球</h2>
    <el-alert
      title="启用后，页面右侧会显示快捷翻译按钮，点击翻译，再次点击切换回原文"
      type="info" :closable="false" show-icon style="margin-bottom: 8px"
    />

    <SettingRow title="启用悬浮球" desc="在页面右侧显示快捷翻译按钮">
      <el-switch :model-value="store.config.floatball.enabled" @update:model-value="store.patch({ floatball: { enabled: $event } })" />
    </SettingRow>

    <SettingRow title="悬浮球悬停延迟 (ms)" desc="鼠标悬停多久显示功能按钮，默认 500">
      <el-input-number
        :model-value="store.config.floatball.hoverDelayMs"
        :min="100" :max="2000" :step="100"
        @update:model-value="store.patch({ floatball: { hoverDelayMs: $event } })"
      />
    </SettingRow>

    <SettingRow title="透明度" desc="数值越大悬浮球越透明（0-90）">
      <el-slider
        :model-value="store.config.floatball.transparency"
        :min="0" :max="90"
        style="width: 200px"
        @update:model-value="store.patch({ floatball: { transparency: $event } })"
      />
    </SettingRow>

    <SettingRow title="点击行为" desc="悬浮球主按钮点击时的动作">
      <el-select
        :model-value="store.config.floatball.clickType"
        style="width: 200px"
        @update:model-value="store.patch({ floatball: { clickType: $event } })"
      >
        <el-option value="translate" label="翻译/显示原文" />
        <el-option value="panel" label="打开快捷面板" />
      </el-select>
    </SettingRow>

    <SettingRow title="侧边栏按钮显示方式" desc="悬浮球上侧边栏入口的显隐（原版默认隐藏，来自版本化覆盖）">
      <el-switch
        :model-value="store.config.floatball.showSidePanelButton"
        @update:model-value="store.patch({ floatball: { showSidePanelButton: $event } })"
      />
    </SettingRow>

    <h3>禁用网站</h3>
    <el-alert title="遇下列网站时不显示悬浮球（支持 * 通配）" type="info" :closable="false" show-icon style="margin-bottom: 8px" />
    <div v-for="(u, i) in store.config.floatball.blockUrls" :key="u + i" class="blocked-row">
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
h3 { font-size: 15px; margin: 20px 0 8px; }
.blocked-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 4px;
  border-bottom: 1px solid var(--el-border-color-lighter);
}
.add-row { display: flex; gap: 8px; margin-top: 10px; }
</style>
