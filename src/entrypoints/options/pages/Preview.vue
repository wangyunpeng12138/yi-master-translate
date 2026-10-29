<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { useConfigStore } from '@/core/config/ConfigStore';
import { t } from '@/core/i18n';
import LangPicker from '@/components/LangPicker.vue';
import ServicePicker from '@/components/ServicePicker.vue';
import SettingRow from '@/components/SettingRow.vue';

/**
 * P1/P2 验收页：
 * - P1：组件渲染 + 配置读写联动（storage 多窗口同步）
 * - P2：翻译服务测试（经 background translate:batch 真实出网）
 */

const store = useConfigStore();
let unbind: (() => void) | null = null;

const testText = ref(t('preview.testInput'));
const testing = ref(false);
const testResult = ref('');
const testError = ref('');

async function runTest() {
  testing.value = true;
  testResult.value = '';
  testError.value = '';
  try {
    const res = (await browser.runtime.sendMessage({
      type: 'translate:batch',
      payload: {
        texts: [testText.value],
        from: 'auto',
        to: store.config.general.targetLanguage,
        service: store.config.general.service,
        scope: 'text',
      },
    })) as { texts?: string[] };
    testResult.value = res?.texts?.[0] ?? '(空结果)';
  } catch (e) {
    testError.value = e instanceof Error ? e.message : String(e);
  } finally {
    testing.value = false;
  }
}

onMounted(async () => {
  await store.load();
  unbind = store.bindSync();
});
onUnmounted(() => unbind?.());
</script>

<template>
  <div class="preview">
    <h2 class="section-title">{{ t('preview.title') }}</h2>
    <el-alert :title="t('preview.desc')" type="info" :closable="false" show-icon style="margin-bottom: 16px" />

    <h3>{{ t('preview.configBinding') }}</h3>
    <SettingRow :title="t('general.targetLanguage')" :desc="t('general.targetLanguageDesc')">
      <LangPicker :model-value="store.config.general.targetLanguage" @update:model-value="store.patch({ general: { targetLanguage: $event } })" />
    </SettingRow>
    <SettingRow :title="t('general.interfaceLanguage')" :desc="t('general.interfaceLanguageDesc')">
      <LangPicker :model-value="store.config.general.interfaceLanguage" @update:model-value="store.patch({ general: { interfaceLanguage: $event as 'zh-CN' | 'en' } })" />
    </SettingRow>
    <SettingRow :title="t('general.service')" :desc="t('general.serviceDesc')">
      <ServicePicker :model-value="store.config.general.service" @update:model-value="store.patch({ general: { service: $event } })" />
    </SettingRow>
    <SettingRow :title="t('general.displayMode')" :desc="t('general.displayModeDesc')">
      <el-select
        :model-value="store.config.general.displayMode"
        style="width: 220px"
        @update:model-value="store.patch({ general: { displayMode: $event } })"
      >
        <el-option value="dual" :label="t('general.displayModeDual')" />
        <el-option value="only" :label="t('general.displayModeOnly')" />
      </el-select>
    </SettingRow>
    <SettingRow :title="t('floating.enable')" :desc="t('floating.enableDesc')">
      <el-switch :model-value="store.config.floatball.enabled" @update:model-value="store.patch({ floatball: { enabled: $event } })" />
    </SettingRow>
    <div style="margin: 12px 0 32px">
      <el-button size="small" @click="store.reset()">{{ t('common.reset') }}</el-button>
    </div>

    <h3>{{ t('preview.serviceTest') }}</h3>
    <el-input v-model="testText" type="textarea" :rows="2" style="max-width: 640px" />
    <div style="margin: 8px 0">
      <el-button type="primary" :loading="testing" @click="runTest">{{ t('common.testService') }}</el-button>
    </div>
    <el-alert v-if="testResult" :title="testResult" type="success" :closable="false" show-icon />
    <el-alert v-if="testError" :title="`${t('common.testFailed')}: ${testError}`" type="error" :closable="false" show-icon />
  </div>
</template>

<style scoped>
.preview :deep(h3) {
  margin: 24px 0 4px;
  font-size: 16px;
}
.section-title {
  margin-top: 0;
}
</style>
