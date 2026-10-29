<script setup lang="ts">
import { onMounted } from 'vue';
import { useConfigStore } from '@/core/config/ConfigStore';
import SettingRow from '@/components/SettingRow.vue';

const store = useConfigStore();
onMounted(() => store.load());
</script>

<template>
  <div>
    <h2 class="section-title">进阶设置</h2>

    <SettingRow title="翻译段落所需的最少字符数" desc="设置为更大的值可以减少不必要的小段落翻译（默认 2）">
      <el-input-number
        :model-value="store.config.engine.minParagraphChars"
        :min="1" :max="50"
        @update:model-value="store.patch({ engine: { minParagraphChars: $event } })"
      />
    </SettingRow>

    <SettingRow title="直接翻译页面前多少个字符" desc="无需等待滚动到可视区域，默认 4999">
      <el-input-number
        :model-value="store.config.engine.preTranslateChars"
        :min="500" :max="100000" :step="500"
        @update:model-value="store.patch({ engine: { preTranslateChars: $event } })"
      />
    </SettingRow>

    <SettingRow title="开启长段落自动换行" desc="长段落中每句话结束插入换行符便于阅读">
      <el-switch :model-value="store.config.engine.longParagraphWrap" @update:model-value="store.patch({ engine: { longParagraphWrap: $event } })" />
    </SettingRow>

    <SettingRow title="进入网页后立即翻译到页面底部" desc="开启则整页立即翻译，关闭则边看边译（不推荐开启）">
      <el-switch :model-value="store.config.engine.translateToPageEndImmediately" @update:model-value="store.patch({ engine: { translateToPageEndImmediately: $event } })" />
    </SettingRow>

    <SettingRow title="启用右键菜单项" desc="网页、图片、选中文本等场景的右键菜单">
      <el-switch :model-value="store.config.contextMenu.enabled" @update:model-value="store.patch({ contextMenu: { enabled: $event } })" />
    </SettingRow>

    <SettingRow title="是否翻译网页所有区域" desc="默认智能识别仅翻译主要区域（不推荐开启）">
      <el-switch :model-value="store.config.engine.translateWholePage" @update:model-value="store.patch({ engine: { translateWholePage: $event } })" />
    </SettingRow>

    <SettingRow title="启用侧边栏翻译" desc="翻译网页的侧边栏区域">
      <el-switch :model-value="store.config.engine.translateSidebar" @update:model-value="store.patch({ engine: { translateSidebar: $event } })" />
    </SettingRow>

    <SettingRow title="开启翻译网页标题" desc="网页标题（document.title）会被翻译">
      <el-switch :model-value="store.config.engine.translateTitle" @update:model-value="store.patch({ engine: { translateTitle: $event } })" />
    </SettingRow>

    <SettingRow title="检测页面语言与目标语言是否相同" desc="相同则提示无法进行翻译">
      <el-switch :model-value="store.config.engine.sameLangCheck" @update:model-value="store.patch({ engine: { sameLangCheck: $event } })" />
    </SettingRow>

    <SettingRow title="Loading 样式" desc="等待译文加载时的样式">
      <el-select
        :model-value="store.config.engine.loadingTheme"
        style="width: 180px"
        @update:model-value="store.patch({ engine: { loadingTheme: $event } })"
      >
        <el-option value="spinner" label="转圈动画" />
        <el-option value="text" label="文字提示" />
        <el-option value="none" label="无" />
      </el-select>
    </SettingRow>

    <SettingRow title="临时开启网站翻译的时长" desc="手动翻译某网页时临时记为自动翻译的时长，0 = 禁用">
      <el-select
        :model-value="String(store.config.engine.tempAutoTranslateMinutes)"
        style="width: 180px"
        @update:model-value="store.patch({ engine: { tempAutoTranslateMinutes: Number($event) } })"
      >
        <el-option value="0" label="禁用" />
        <el-option value="10" label="10 分钟" />
        <el-option value="60" label="1 小时" />
        <el-option value="1440" label="当天" />
      </el-select>
    </SettingRow>

    <SettingRow title="仅译文模式的语言" desc="页面语言为下列语言时自动使用仅译文模式（逗号分隔，如 zh-TW,en）">
      <el-input
        :model-value="store.config.engine.onlyTranslationLangs.join(',')"
        style="width: 300px"
        @update:model-value="store.patch({ engine: { onlyTranslationLangs: ($event as string).split(',').map(s => s.trim()).filter(Boolean) } })"
      />
    </SettingRow>

    <SettingRow title="仅译文模式的网址" desc="每行一个通配域名">
      <el-input
        :model-value="store.config.engine.onlyTranslationUrls.join('\n')"
        type="textarea" :rows="2" style="width: 300px"
        @update:model-value="store.patch({ engine: { onlyTranslationUrls: ($event as string).split('\n').map(s => s.trim()).filter(Boolean) } })"
      />
    </SettingRow>

    <SettingRow title="站内页面自动翻译" desc="翻译当前页面时，跳转站内其他页面也自动翻译">
      <el-switch :model-value="store.config.engine.autoTranslateInSite" @update:model-value="store.patch({ engine: { autoTranslateInSite: $event } })" />
    </SettingRow>
  </div>
</template>

<style scoped>
.section-title { margin-top: 0; }
</style>
