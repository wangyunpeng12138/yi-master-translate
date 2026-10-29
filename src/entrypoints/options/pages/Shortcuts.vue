<script setup lang="ts">
/** 快捷键分区：浏览器级命令清单（chrome://extensions/shortcuts 管理）+ 扩展内记录 */
const COMMANDS: Array<{ id: string; desc: string; key?: string; browserManaged: boolean }> = [
  { id: 'toggleTranslatePage', desc: '翻译为简体中文（翻译网页/显示原文）', key: 'Alt+A', browserManaged: true },
  { id: 'toggleTranslateTheWholePage', desc: '翻译页面全部区域/显示原文', key: 'Alt+W', browserManaged: true },
  { id: 'toggleTranslateTheMainPage', desc: '翻译页面主要区域/显示原文', browserManaged: true },
  { id: 'toggleSidePanel', desc: '开启/关闭侧边栏', key: 'Alt+S', browserManaged: true },
  { id: 'translateInputBox', desc: '翻译当前输入框内容', key: 'Alt+I', browserManaged: true },
  { id: 'toggleOnlyTransation', desc: '切换双语/仅译文模式', browserManaged: true },
  { id: 'toggleTranslateToThePageEndImmediately', desc: '立即翻译到页面底部/显示原文', browserManaged: true },
  { id: 'toggleTranslationMask', desc: '切换译文模糊效果（学习模式）', browserManaged: true },
  { id: 'openAiWritingModal', desc: '打开 AI Write 弹窗', browserManaged: true },
  { id: 'toggleMouseHoverTranslateDirectly', desc: '临时启用/关闭鼠标悬停直接翻译', browserManaged: true },
  { id: 'toggleVideoSubtitlePreTranslation', desc: '切换双语字幕优先使用本扩展设置', browserManaged: true },
  { id: 'translateWithBing', desc: '临时使用微软翻译当前页面', browserManaged: true },
  { id: 'translateWithGoogle', desc: '临时使用谷歌翻译当前页面', browserManaged: true },
  { id: 'translateWithDeepL', desc: '临时使用 DeepL 翻译当前页面', browserManaged: true },
  { id: 'translateWithOpenAI', desc: '临时使用 OpenAI 翻译当前页面', browserManaged: true },
  { id: 'translateWithGemini', desc: '临时使用 Gemini 翻译当前页面', browserManaged: true },
  { id: 'translateWithClaude', desc: '临时使用 Claude 翻译当前页面', browserManaged: true },
  { id: 'translateWithTransmart', desc: '临时使用腾讯翻译当前页面', browserManaged: true },
  { id: 'translateWithCustom1', desc: '临时使用自定义服务翻译当前页面(1)', browserManaged: true },
  { id: 'translateWithCustom2', desc: '临时使用自定义服务翻译当前页面(2)', browserManaged: true },
  { id: 'translateWithCustom3', desc: '临时使用自定义服务翻译当前页面(3)', browserManaged: true },
];

function openShortcuts() {
  void browser.tabs.create({ url: 'chrome://extensions/shortcuts' });
}
</script>

<template>
  <div>
    <h2 class="section-title">快捷键设置</h2>
    <el-alert
      title="所有快捷键均为浏览器级命令，需在 Chrome 扩展快捷键页面统一修改"
      type="info" :closable="false" show-icon
      style="margin-bottom: 12px"
    >
      <el-button size="small" type="primary" @click="openShortcuts">打开 chrome://extensions/shortcuts</el-button>
    </el-alert>

    <el-table :data="COMMANDS" size="small" :row-key="(r: typeof COMMANDS[number]) => r.id">
      <el-table-column prop="desc" label="功能" min-width="280" />
      <el-table-column label="默认键位" width="140">
        <template #default="{ row }">
          <el-tag v-if="row.key" size="small">{{ row.key }}</el-tag>
          <span v-else style="color: var(--el-text-color-secondary)">未绑定</span>
        </template>
      </el-table-column>
      <el-table-column label="修改位置" width="180">
        <template #default>
          <span style="font-size: 12px; color: var(--el-text-color-secondary)">浏览器扩展快捷键页</span>
        </template>
      </el-table-column>
    </el-table>
  </div>
</template>

<style scoped>
.section-title { margin-top: 0; }
</style>
