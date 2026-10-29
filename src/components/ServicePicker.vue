<script setup lang="ts">
/**
 * 翻译服务选择器
 * 数据来自 core/services/registry（P2）；支持 inherit 选项（跟随主服务）
 */
import { computed } from 'vue';
import { listServices } from '@/core/services/registry';

const props = defineProps<{
  modelValue: string;
  /** 允许选择 inherit（用于字幕/输入框等子场景） */
  allowInherit?: boolean;
}>();

const emit = defineEmits<{ 'update:modelValue': [v: string] }>();

const options = computed(() => listServices());
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
