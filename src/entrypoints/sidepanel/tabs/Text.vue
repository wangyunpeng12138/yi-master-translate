<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useConfigStore } from '@/core/config/ConfigStore';
import LangPicker from '@/components/LangPicker.vue';

/** 文本翻译标签（P7）：输入 → background translate:batch → 双语结果 */
const store = useConfigStore();
const text = ref('');
const result = ref('');
const busy = ref(false);
const error = ref('');

async function translate() {
  if (!text.value.trim()) return;
  busy.value = true;
  error.value = '';
  result.value = '';
  try {
    const res = (await browser.runtime.sendMessage({
      type: 'translate:batch',
      payload: {
        texts: [text.value],
        from: 'auto',
        to: store.config.general.targetLanguage,
        service: store.config.general.service,
        scope: 'text',
      },
    })) as { texts?: string[] };
    result.value = res?.texts?.[0] ?? '';
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    busy.value = false;
  }
}

async function copy() {
  await navigator.clipboard.writeText(result.value);
}

onMounted(() => store.load());
</script>

<template>
  <div class="text-tab">
    <div class="lang-row">
      <span class="lang-fixed">自动检测</span>
      <span>→</span>
      <LangPicker
        :model-value="store.config.general.targetLanguage"
        style="flex: 1; width: auto"
        @update:model-value="store.patch({ general: { targetLanguage: $event } })"
      />
    </div>
    <el-input v-model="text" type="textarea" :rows="6" placeholder="请输入或粘贴文本…" />
    <div class="ops">
      <el-button type="primary" size="small" :loading="busy" @click="translate">翻译</el-button>
      <el-button v-if="result" size="small" @click="copy">复制译文</el-button>
    </div>
    <el-alert v-if="error" :title="`失败：${error}`" type="error" :closable="false" show-icon />
    <el-input v-if="result" :model-value="result" type="textarea" :rows="8" readonly class="result" />
  </div>
</template>

<style scoped>
.text-tab { padding: 4px; }
.lang-row { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.lang-fixed { flex: 1; font-size: 13px; color: var(--el-text-color-secondary); padding: 4px 8px; border: 1px solid var(--el-border-color); border-radius: 4px; background: var(--el-fill-color-lighter); }
.ops { display: flex; gap: 8px; margin: 8px 0; }
.result { margin-top: 4px; }
</style>
