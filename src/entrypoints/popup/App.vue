<script setup lang="ts">
import { ref } from 'vue';

const version = ref(browser.runtime.getManifest().version);
</script>

<template>
  <div class="popup-shell">
    <div class="popup-header">
      <span class="brand">沉浸式翻译（复刻版）</span>
      <el-tag size="small" type="info">v{{ version }}</el-tag>
    </div>
    <el-divider style="margin: 10px 0" />
    <el-empty description="P0 骨架：翻译控制区在 P4 实现" :image-size="60" />
    <div class="popup-footer">
      <el-button
        size="small"
        @click="browser.runtime.openOptionsPage()"
      >
        打开设置页
      </el-button>
    </div>
  </div>
</template>

<style scoped>
.popup-shell {
  width: 320px;
  padding: 12px;
}
.popup-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.brand {
  font-weight: 600;
}
.popup-footer {
  text-align: center;
}
</style>
