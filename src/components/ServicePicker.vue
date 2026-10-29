<script setup lang="ts">
/**
 * 翻译服务选择器
 * 数据来自 core/services/registry；支持 inherit 选项（跟随主服务）；
 * 内部读 ConfigStore 以列出用户自定义服务（否则下拉只显示内置服务，
 * 选中自定义服务时会裸显服务 ID 而非用户配置的名称）
 */
import { computed } from 'vue';
import { listServices } from '@/core/services/registry';
import { useConfigStore } from '@/core/config/ConfigStore';

const props = defineProps<{
  modelValue: string;
  /** 允许选择 inherit（用于字幕/输入框等子场景） */
  allowInherit?: boolean;
  /** 仅列出已配置可用的 AI 服务（用于 AI 搜索等必须 AI 的场景；
   *  需 key 但未填/非本地的服务会被过滤，避免选中后必然报错） */
  aiOnly?: boolean;
}>();

const emit = defineEmits<{ 'update:modelValue': [v: string] }>();

const store = useConfigStore();
const options = computed(() =>
  props.aiOnly
    ? listServices(store.config).filter((s) => s.kind === 'ai' && !s.needsSetup)
    : listServices(store.config),
);
const showInherit = computed(() => props.allowInherit);
</script>

<template>
  <el-select
    :model-value="modelValue"
    style="width: 220px"
    popper-class="imt-rebuild-svc-popper"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <el-option v-if="showInherit" value="inherit" label="跟随全局翻译服务" />
    <el-option
      v-for="s in options"
      :key="s.id"
      :value="s.id"
      :label="s.name"
    >
      <span style="display: flex; justify-content: space-between; width: 100%">
        <span>{{ s.name }}</span>
        <el-tag size="small" :type="s.kind === 'ai' ? 'warning' : 'info'">
          {{ s.kind === 'ai' ? 'AI' : '机器' }}
        </el-tag>
      </span>
    </el-option>
  </el-select>
</template>

<style>
/* 服务下拉在 popup 等小视口中会被浏览器窗口底部裁剪 → 限制最大高度内部滚动 */
.el-select__popper.imt-rebuild-svc-popper .el-select-dropdown__list {
  max-height: 208px;
  overflow-y: auto;
}
</style>
