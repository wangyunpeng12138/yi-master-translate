<script setup lang="ts">
import { onMounted } from 'vue';
import { useConfigStore } from '@/core/config/ConfigStore';
import SettingRow from '@/components/SettingRow.vue';
import LangPicker from '@/components/LangPicker.vue';
import ServicePicker from '@/components/ServicePicker.vue';
import { runServiceTest } from '@/core/services/serviceTest';

const store = useConfigStore();

const THEMES = [
  { value: 'none', label: '无' },
  { value: 'dashed', label: '虚线下划线' },
  { value: 'background', label: '背景色' },
  { value: 'blur', label: '模糊（学习模式）' },
];

onMounted(() => store.load());
</script>

<template>
  <div>
    <h2 class="section-title">基本设置</h2>

    <SettingRow title="目标语言" desc="指定您希望将内容翻译成的语言">
      <LangPicker
        :model-value="store.config.general.targetLanguage"
        @update:model-value="store.patch({ general: { targetLanguage: $event } })"
      />
    </SettingRow>

    <SettingRow title="翻译服务" desc="选择一项翻译服务">
      <div style="display: flex; gap: 8px; align-items: center">
        <ServicePicker
          :model-value="store.config.general.service"
          @update:model-value="store.patch({ general: { service: $event } })"
        />
        <el-button size="small" text type="primary" @click="runServiceTest(store, 'general')">测试服务</el-button>
      </div>
    </SettingRow>

    <SettingRow title="界面语言" desc="仅影响控制面板显示语言，与翻译的目标语言无关">
      <el-select
        :model-value="store.config.general.interfaceLanguage"
        style="width: 220px"
        @update:model-value="store.patch({ general: { interfaceLanguage: $event } })"
      >
        <el-option value="zh-CN" label="简体中文" />
        <el-option value="en" label="English" />
      </el-select>
    </SettingRow>

    <SettingRow title="翻译偏好" desc="翻译后的显示方式">
      <el-radio-group
        :model-value="store.config.general.displayMode"
        @update:model-value="store.patch({ general: { displayMode: $event } })"
      >
        <el-radio-button value="dual" label="双语对照" />
        <el-radio-button value="only" label="仅译文" />
      </el-radio-group>
    </SettingRow>

    <SettingRow title="译文在先，原文随后" desc="开启后每个段落的译文将在原文前面">
      <el-switch
        :model-value="store.config.general.translationPosition === 'before'"
        @update:model-value="store.patch({ general: { translationPosition: $event ? 'before' : 'after' } })"
      />
    </SettingRow>

    <SettingRow title="相近语言译文背景色" desc="页面语言与目标语言相近时（如中日韩互译）给译文加背景色便于区分">
      <el-switch
        :model-value="store.config.general.sameLangTheme === 'background'"
        @update:model-value="store.patch({ general: { sameLangTheme: $event ? 'background' : 'none' } })"
      />
    </SettingRow>

    <SettingRow title="译文显示样式" desc="译文区域的视觉主题">
      <el-select
        :model-value="store.config.general.translationTheme"
        style="width: 220px"
        @update:model-value="store.patch({ general: { translationTheme: $event } })"
      >
        <el-option v-for="t in THEMES" :key="t.value" :value="t.value" :label="t.label" />
      </el-select>
    </SettingRow>

    <!-- 样式预览示例（对齐原版实时示例） -->
    <div class="theme-preview" :class="`imt-rebuild-theme-${store.config.general.translationTheme}`">
      不要温和地走入那个良夜，老年应当在日暮时燃烧咆哮；
      <span class="imt-rebuild-target-wrapper imt-rebuild-theme-fake">Do not go gentle into that good night.</span>
    </div>

    <SettingRow title="指定域名强制「无」样式" desc="每行一个域名通配（如 *.example.com）">
      <el-input
        :model-value="(store.config.general.forceNoneThemeUrls ?? []).join('\n')"
        type="textarea"
        :rows="2"
        style="width: 300px"
        placeholder="*.example.com"
        @update:model-value="store.patch({ general: { forceNoneThemeUrls: ($event as string).split('\n').map(s => s.trim()).filter(Boolean) } })"
      />
    </SettingRow>
  </div>
</template>

<style scoped>
.section-title { margin-top: 0; }
.theme-preview {
  margin: 12px 4px 20px;
  padding: 10px 14px;
  border: 1px dashed var(--el-border-color);
  border-radius: 6px;
  background: var(--el-fill-color-lighter);
  line-height: 2;
}
</style>
