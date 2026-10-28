<script setup lang="ts">
import { ref } from 'vue';

const tab = ref('text');
</script>

<template>
  <div class="sidepanel-shell">
    <el-tabs v-model="tab" class="sidepanel-tabs">
      <el-tab-pane label="文本" name="text">
        <el-empty description="文本翻译（P7 实现）" :image-size="60" />
      </el-tab-pane>
      <el-tab-pane label="文档" name="docs">
        <el-empty description="文档翻译（P7 实现）" :image-size="60" />
      </el-tab-pane>
      <el-tab-pane label="视频" name="video">
        <el-empty description="视频字幕说明（P7 实现）" :image-size="60" />
      </el-tab-pane>
      <el-tab-pane label="图片" name="image">
        <el-empty description="图片翻译（P7 实现）" :image-size="60" />
      </el-tab-pane>
      <el-tab-pane label="教程" name="guide">
        <el-empty description="内置使用教程（P7 实现）" :image-size="60" />
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<style scoped>
.sidepanel-shell {
  padding: 8px;
}
</style>
