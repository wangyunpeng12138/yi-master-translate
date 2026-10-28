<script setup lang="ts">
/**
 * 语言选择器（目标语言 / 界面语言通用）
 * 清单覆盖原版常用语言集
 */
defineProps<{
  modelValue: string;
  /** 附加自动检测选项 */
  autoDetect?: boolean;
}>();

const emit = defineEmits<{ 'update:modelValue': [v: string] }>();

const LANGUAGES: Array<{ code: string; label: string }> = [
  { code: 'zh-CN', label: '简体中文' },
  { code: 'zh-TW', label: '繁体中文' },
  { code: 'en', label: '英语' },
  { code: 'ja', label: '日语' },
  { code: 'ko', label: '韩语' },
  { code: 'fr', label: '法语' },
  { code: 'de', label: '德语' },
  { code: 'es', label: '西班牙语' },
  { code: 'pt', label: '葡萄牙语' },
  { code: 'it', label: '意大利语' },
  { code: 'ru', label: '俄语' },
  { code: 'ar', label: '阿拉伯语' },
  { code: 'hi', label: '印地语' },
  { code: 'id', label: '印尼语' },
  { code: 'vi', label: '越南语' },
  { code: 'th', label: '泰语' },
  { code: 'tr', label: '土耳其语' },
  { code: 'nl', label: '荷兰语' },
  { code: 'pl', label: '波兰语' },
  { code: 'sv', label: '瑞典语' },
];
</script>

<template>
  <el-select
    :model-value="modelValue"
    filterable
    style="width: 220px"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <el-option v-if="autoDetect" value="auto" label="自动检测" />
    <el-option
      v-for="lang in LANGUAGES"
      :key="lang.code"
      :value="lang.code"
      :label="lang.label"
    />
  </el-select>
</template>
