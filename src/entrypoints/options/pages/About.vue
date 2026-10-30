<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useConfigStore } from '@/core/config/ConfigStore';
import SettingRow from '@/components/SettingRow.vue';
import { clearTranslationCache, formatBytes, getCacheStats } from '@/core/services/cacheStats';

const store = useConfigStore();
const version = browser.runtime.getManifest().version;
const cache = ref({ entries: 0, bytes: 0 });

async function refreshCache() {
  cache.value = await getCacheStats();
}

async function onClearCache() {
  await clearTranslationCache();
  await refreshCache();
}

onMounted(async () => {
  await store.load();
  await refreshCache();
});
</script>

<template>
  <div>
    <h2 class="section-title">关于</h2>

    <div class="ver-line">
      <span class="ver">{{ version }}</span>
      <el-tag size="small" type="info">译大师（开源工程）</el-tag>
    </div>

    <SettingRow title="启用扩展" desc="扩展功能总开关（关闭后快捷键与悬浮球均不响应）">
      <el-switch :model-value="store.config.app.enabled" @update:model-value="store.patch({ app: { enabled: $event } })" />
    </SettingRow>

    <SettingRow title="开启本地翻译缓存" desc="减少重复段落的翻译请求">
      <el-switch :model-value="store.config.cache.enabled" @update:model-value="store.patch({ cache: { enabled: $event } })" />
    </SettingRow>

    <SettingRow title="缓存管理" :desc="`当前缓存：${cache.entries} 条 / ${formatBytes(cache.bytes)}`">
      <el-button size="small" @click="onClearCache">清除缓存</el-button>
    </SettingRow>

    <div class="about-links">
      <p>译大师是一款开源的双语网页翻译扩展（Chrome MV3），功能对齐沉浸式翻译 v1.34.4 的个人学习工程：</p>
      <ul class="feature-list">
        <li>保留：网页双语翻译、翻译服务（免费通道 + 自定义 API）、输入框/划词/圈选/悬停翻译、悬浮球、视频字幕、图片/漫画本地 OCR、术语库、AI 专家、配置导入导出、缓存、右键菜单</li>
        <li>裁剪：官网链接与推广位、会员付费体系、云同步、遥测、EPUB 在线制作、无字幕翻译（云端 ASR）</li>
      </ul>
      <p class="license">本项目为独立实现，与「沉浸式翻译」及其官方（Funstory.ai Limited）无任何关联或授权关系；「沉浸式翻译」名称及相关权利归其权利人所有。本项目仅供学习研究。</p>
    </div>
  </div>
</template>

<style scoped>
.section-title { margin-top: 0; }
.ver-line { display: flex; gap: 10px; align-items: center; margin-bottom: 16px; }
.ver { font-size: 20px; font-weight: 600; }
.about-links { margin-top: 24px; color: var(--el-text-color-secondary); font-size: 13px; line-height: 1.8; }
.feature-list { margin: 4px 0 12px; padding-left: 18px; }
.license { color: var(--el-color-warning); }
</style>
