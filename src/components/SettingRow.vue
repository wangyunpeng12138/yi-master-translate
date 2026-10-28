<script setup lang="ts">
/**
 * 设置行容器：标题 + 说明 + 控件插槽（对齐原版设置页版式）
 */
defineProps<{
  title: string;
  desc?: string;
}>();
</script>

<template>
  <div class="setting-row">
    <div class="setting-text">
      <div class="setting-title">{{ title }}</div>
      <div v-if="desc" class="setting-desc">{{ desc }}</div>
    </div>
    <div class="setting-control"><slot /></div>
  </div>
</template>

<style scoped>
.setting-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  padding: 14px 4px;
  border-bottom: 1px solid var(--el-border-color-lighter);
}
.setting-text {
  flex: 1;
  min-width: 0;
}
.setting-title {
  font-weight: 500;
  margin-bottom: 4px;
}
.setting-desc {
  color: var(--el-text-color-secondary);
  font-size: 13px;
  line-height: 1.5;
}
.setting-control {
  flex-shrink: 0;
}
</style>
