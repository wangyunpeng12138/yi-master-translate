<script setup lang="ts">
import { ref } from 'vue';
import zhCn from 'element-plus/es/locale/lang/zh-cn';
import Text from './tabs/Text.vue';
import Docs from './tabs/Docs.vue';
import Image from './tabs/Image.vue';
import Video from './tabs/Video.vue';
import Guide from './tabs/Guide.vue';

/** 侧边栏（P7）：文本 / 文档 / 视频 / 图片 / 教程 5 标签本地实现 */
const tab = ref('text');
</script>

<template>
  <el-config-provider :locale="zhCn">
    <div class="sidepanel-shell">
      <el-tabs v-model="tab" class="sidepanel-tabs">
        <el-tab-pane label="文本" name="text" lazy><Text /></el-tab-pane>
        <el-tab-pane label="文档" name="docs" lazy><Docs /></el-tab-pane>
        <el-tab-pane label="视频" name="video" lazy><Video /></el-tab-pane>
        <el-tab-pane label="图片" name="image" lazy><Image /></el-tab-pane>
        <el-tab-pane label="教程" name="guide" lazy><Guide /></el-tab-pane>
      </el-tabs>
    </div>
  </el-config-provider>
</template>

<style scoped>
.sidepanel-shell {
  padding: 8px 12px;
}
</style>
