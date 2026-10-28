<script setup lang="ts">
import { useRoute } from 'vue-router';
import zhCn from 'element-plus/es/locale/lang/zh-cn';
import { SECTIONS } from './router';

const route = useRoute();
const version = browser.runtime.getManifest().version;
</script>

<template>
  <el-config-provider :locale="zhCn">
    <el-container class="options-shell">
    <el-aside width="220px" class="options-aside">
      <div class="brand">
        沉浸式翻译（复刻版）
        <el-tag size="small" type="info">{{ version }}</el-tag>
      </div>
      <el-menu :default-active="route.path" router class="options-menu">
        <el-menu-item v-for="s in SECTIONS" :key="s.path" :index="`/${s.path}`">
          {{ s.title }}
        </el-menu-item>
      </el-menu>
    </el-aside>
    <el-main class="options-main">
      <router-view />
    </el-main>
  </el-container>
  </el-config-provider>
</template>

<style scoped>
.options-shell {
  height: 100vh;
}
.options-aside {
  border-right: 1px solid var(--el-border-color-light);
}
.brand {
  font-weight: 600;
  padding: 16px;
  display: flex;
  align-items: center;
  gap: 8px;
}
.options-menu {
  border-right: none;
}
.options-main {
  max-width: 860px;
}
</style>
