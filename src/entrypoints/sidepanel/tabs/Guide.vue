<script setup lang="ts">
/** 使用教程标签（P7）：内置说明替代原版跳转官网教程 */
const STEPS = [
  { title: '1. 翻译网页', desc: '任意网页按 Alt+A，或点击页面右侧悬浮球 / 工具栏弹窗的「翻译」按钮，即可双语对照；再次操作切回原文。' },
  { title: '2. 设置默认服务', desc: '设置 → 翻译服务：免费通道（微软/谷歌）开箱即用；AI 翻译请添加自定义服务（OpenAI 兼容，支持 DeepSeek、Kimi 等）。' },
  { title: '3. 划词翻译', desc: '设置 → 划词翻译：开启后选中文字出现小圆点，点击即翻译（AI 服务）。' },
  { title: '4. 输入框翻译', desc: '在任意输入框输入中文，快速按空格键 3 次，自动翻译为目标语言（适合用中文写英文回复）。' },
  { title: '5. 鼠标悬停', desc: '设置 → 鼠标悬停：选择触发键（如 Alt），按住并悬停段落即翻译该段。' },
  { title: '6. 圈选翻译', desc: '设置 → 划词翻译：开启圈选后，按住 Z 键拖拽选区，截图 OCR 识别并翻译（本地 tesseract）。' },
  { title: '7. 图片翻译', desc: '网页图片右键「翻译图片」，或侧边栏「图片」标签上传图片。' },
  { title: '8. 视频字幕', desc: '支持平台的视频播放页自动出现双语字幕；离线字幕文件在「文档」标签翻译并导出双语文件。' },
  { title: '9. AI Write', desc: '工具栏快捷键绑定 openAiWritingModal 后呼出独立写作面板，支持润色与翻译写作（需自定义 AI 服务）。' },
];
</script>

<template>
  <div class="guide-tab">
    <h4>快速上手</h4>
    <div v-for="s in STEPS" :key="s.title" class="step">
      <div class="step-title">{{ s.title }}</div>
      <div class="step-desc">{{ s.desc }}</div>
    </div>
    <p class="more">完整功能地图见工程文档《功能梳理.md》；裁剪项清单见《实现方案.md》§1.2。</p>
  </div>
</template>

<style scoped>
.guide-tab { padding: 4px; font-size: 13px; }
h4 { margin: 14px 0 8px; font-size: 14px; }
.step { margin-bottom: 12px; }
.step-title { font-weight: 600; margin-bottom: 2px; }
.step-desc { color: var(--el-text-color-secondary); line-height: 1.7; }
.more { color: var(--el-text-color-secondary); font-size: 12px; margin-top: 16px; }
</style>
