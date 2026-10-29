<script setup lang="ts">
import { onMounted } from 'vue';
import { useConfigStore } from '@/core/config/ConfigStore';
import SettingRow from '@/components/SettingRow.vue';
import ServicePicker from '@/components/ServicePicker.vue';

const store = useConfigStore();

const TRIGGER_KEYS = [
  { value: 'Off', label: '不做任何事情' },
  { value: 'altKey', label: 'Alt' },
  { value: 'ctrlKey', label: 'Ctrl' },
  { value: 'metaKey', label: '⌘/Win' },
  { value: 'shiftKey', label: 'Shift' },
];

onMounted(() => store.load());
</script>

<template>
  <div>
    <h2 class="section-title">鼠标悬停</h2>
    <el-alert
      title="将鼠标放在段落上，同时按下设定的触发键，即可翻译该段落。默认未启用（Off）。此功能也可强制翻译任何无法被识别的翻译区域。"
      type="info" :closable="false" show-icon style="margin-bottom: 8px"
    />

    <SettingRow title="悬停翻译触发键" desc="悬停段落时按住该键触发翻译（原版默认 Off）">
      <el-select
        :model-value="store.config.hover.holdKey"
        style="width: 200px"
        @update:model-value="store.patch({ hover: { holdKey: $event } })"
      >
        <el-option v-for="k in TRIGGER_KEYS" :key="k.value" :value="k.value" :label="k.label" />
      </el-select>
    </SettingRow>

    <SettingRow title="触发键长按判定 (ms)" desc="原版 mouseModifierKeyPressTimeout = 400">
      <el-input-number
        :model-value="store.config.hover.keyTimeoutMs"
        :min="100" :max="2000" :step="50"
        @update:model-value="store.patch({ hover: { keyTimeoutMs: $event } })"
      />
    </SettingRow>

    <SettingRow title="翻译服务" desc="悬停翻译可单独指定服务">
      <ServicePicker
        :model-value="store.config.hover.service"
        allow-inherit
        @update:model-value="store.patch({ hover: { service: $event } })"
      />
    </SettingRow>

    <SettingRow title="临时启用直接翻译" desc="快捷键 toggleMouseHoverTranslateDirectly：按下后指向文字即翻译，再按关闭（需在 chrome://extensions/shortcuts 绑定）">
      <span style="color: var(--el-text-color-secondary); font-size: 13px">浏览器级命令，无需在此设置</span>
    </SettingRow>
  </div>
</template>

<style scoped>
.section-title { margin-top: 0; }
</style>
