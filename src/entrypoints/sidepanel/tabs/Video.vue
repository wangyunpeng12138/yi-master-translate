<script setup lang="ts">
/** 视频翻译说明标签（P7 本地实现） */
const PLATFORMS = [
  'YouTube', 'Netflix', 'Bilibili', 'Udemy', 'Coursera', 'TED', 'BBC', 'Disney+',
  'HBO Max', 'Prime Video', 'Hulu', 'iQIYI', 'Youku', 'Dailymotion', 'Vimeo', 'Khan Academy',
];
</script>

<template>
  <div class="video-tab">
    <h4>视频双语字幕</h4>
    <p class="desc">
      在支持的视频网站播放时，扩展会拦截页面已有的字幕轨并翻译为双语字幕
      （实现：<code>&lt;track&gt;</code> 拦截 + vtt 抓取翻译 + 自绘字幕层）。
    </p>
    <el-alert
      title="范围说明：译境仅翻译「已有字幕轨」的视频；无字幕视频的云端 ASR 实时识别（官方功能）已裁剪。YouTube 内嵌字幕优先级等开关见设置页「视频字幕」分区。"
      type="info" :closable="false" show-icon style="margin: 10px 0"
    />
    <h4>支持平台（节选）</h4>
    <div class="platforms">
      <el-tag v-for="p in PLATFORMS" :key="p" size="small" class="tag">{{ p }}</el-tag>
      <span class="more">…共 214 个平台（详见功能梳理文档）</span>
    </div>
    <h4>字幕文件翻译</h4>
    <p class="desc">
      离线字幕文件（srt / ass / vtt / lrc）请到「文档」标签上传，可导出双语字幕文件复用。
    </p>
  </div>
</template>

<style scoped>
.video-tab { padding: 4px; font-size: 13px; }
h4 { margin: 14px 0 6px; font-size: 14px; }
.desc { color: var(--el-text-color-secondary); line-height: 1.8; }
.platforms { display: flex; flex-wrap: wrap; gap: 6px; margin: 8px 0; }
.tag { margin: 0; }
.more { color: var(--el-text-color-secondary); font-size: 12px; }
</style>
