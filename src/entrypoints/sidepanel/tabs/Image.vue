<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useConfigStore } from '@/core/config/ConfigStore';
import LangPicker from '@/components/LangPicker.vue';

/** 图片翻译标签（P7）：上传 → offscreen OCR → 翻译 → 显示 */
const store = useConfigStore();
const src = ref('');
const ocrText = ref('');
const translated = ref('');
const busy = ref(false);
const error = ref('');

async function onFileChosen(ev: Event) {
  const input = ev.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  busy.value = true;
  error.value = '';
  ocrText.value = '';
  translated.value = '';
  try {
    src.value = await fileToDataUrl(file);
    await browser.runtime.sendMessage({ type: 'offscreen:ensure', payload: {} });
    const ocr = (await browser.runtime.sendMessage({
      type: 'ocr:image',
      payload: { dataUrl: src.value },
    })) as { text?: string };
    ocrText.value = (ocr?.text ?? '').trim();
    if (!ocrText.value) throw new Error('OCR 未识别到文字');
    const res = (await browser.runtime.sendMessage({
      type: 'translate:batch',
      payload: {
        texts: [ocrText.value],
        from: 'auto',
        to: store.config.general.targetLanguage,
        service: store.config.general.service,
        scope: 'text',
      },
    })) as { texts?: string[] };
    translated.value = res?.texts?.[0] ?? '';
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    busy.value = false;
  }
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('读取文件失败'));
    reader.readAsDataURL(file);
  });
}

onMounted(() => store.load());
</script>

<template>
  <div class="image-tab">
    <div class="lang-row">
      <span class="hint">译为</span>
      <LangPicker
        :model-value="store.config.general.targetLanguage"
        style="flex: 1; width: auto"
        @update:model-value="store.patch({ general: { targetLanguage: $event } })"
      />
    </div>
    <div class="upload">
      <input type="file" accept="image/png,image/jpeg,image/webp" :disabled="busy" @change="onFileChosen" />
    </div>

    <div v-if="busy" class="status">识别与翻译中…（首次使用需下载 OCR 语言包，请稍候）</div>
    <el-alert v-if="error" :title="`失败：${error}`" type="error" :closable="false" show-icon />

    <div v-if="src" class="preview">
      <img :src="src" alt="待翻译图片" />
    </div>

    <div v-if="ocrText" class="block">
      <h4>OCR 识别文本</h4>
      <pre>{{ ocrText }}</pre>
    </div>
    <div v-if="translated" class="block">
      <h4>译文</h4>
      <pre>{{ translated }}</pre>
    </div>
    <p class="note">提示：网页中的图片也可直接右键「翻译图片」（需在进阶设置开启右键菜单）。</p>
  </div>
</template>

<style scoped>
.image-tab { padding: 4px; font-size: 13px; }
.lang-row { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
.upload { border: 1px dashed var(--el-border-color); border-radius: 8px; padding: 18px; text-align: center; margin-bottom: 8px; }
.hint { color: var(--el-text-color-secondary); }
.status { color: var(--el-color-primary); margin: 8px 0; }
.preview img { max-width: 100%; border-radius: 6px; margin: 10px 0; }
.block h4 { margin: 12px 0 4px; font-size: 13px; }
.block pre {
  background: var(--el-fill-color-lighter); padding: 10px; border-radius: 6px;
  font-size: 12px; white-space: pre-wrap; max-height: 200px; overflow: auto; margin: 0;
}
.note { color: var(--el-text-color-secondary); font-size: 12px; margin-top: 12px; }
</style>
