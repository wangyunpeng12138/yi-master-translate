<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useConfigStore } from '@/core/config/ConfigStore';
import LangPicker from '@/components/LangPicker.vue';
import { isTranslatable, normalizeText } from '@/core/shared/utils';

/**
 * 文档翻译标签（P7 本地实现）
 * 支持 txt/html/md/json/srt/ass/vtt/lrc：
 * - 文本类：按行翻译后输出双语对照 txt
 * - 字幕类（srt/ass/vtt/lrc）：保留时间轴，译文行紧跟原文行，导出双语字幕
 */

const store = useConfigStore();
const busy = ref(false);
const error = ref('');
const fileName = ref('');
const progress = ref('');
const preview = ref('');
const outputBlobUrl = ref('');

const SUBTITLE_EXT = computed(() => ['srt', 'ass', 'ssa', 'vtt', 'lrc']);

function pickLines(raw: string, ext: string): { lines: string[]; indexes: number[] } {
  const all = raw.split(/\r?\n/);
  const indexes: number[] = [];
  const lines: string[] = [];
  const seen = new Set<string>();
  all.forEach((line, i) => {
    const t = line.trim();
    if (!t) return;
    // 跳过字幕元数据与时间轴
    if (SUBTITLE_EXT.value.includes(ext)) {
      if (/^WEBVTT/i.test(t) || /^\[/.test(t) || /^Dialogue:/i.test(t) || /^Format:/i.test(t)) return;
      if (/-->/.test(t)) return;
      if (/^\d+$/.test(t)) return; // srt 序号
      if (ext === 'lrc' && /^\[\d{2}:\d{2}/.test(t)) return;
    }
    if (ext === 'html') {
      // html 粗提取文本
    }
    const norm = normalizeText(t.replace(/<[^>]+>/g, ''));
    if (!isTranslatable(norm, 2)) return;
    if (seen.has(norm)) return;
    seen.add(norm);
    indexes.push(i);
    lines.push(norm);
  });
  return { lines, indexes };
}

async function onFileChosen(ev: Event) {
  const input = ev.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  fileName.value = file.name;
  const ext = (file.name.split('.').pop() ?? 'txt').toLowerCase();
  busy.value = true;
  error.value = '';
  preview.value = '';
  outputBlobUrl.value && URL.revokeObjectURL(outputBlobUrl.value);
  outputBlobUrl.value = '';
  try {
    const raw = await file.text();
    const { lines, indexes } = pickLines(raw, ext);
    if (lines.length === 0) {
      error.value = '未找到可翻译文本';
      return;
    }
    progress.value = `翻译中…（${lines.length} 段）`;

    // 分批翻译（40 段/批）
    const out: string[] = [];
    for (let i = 0; i < lines.length; i += 40) {
      const chunkLines = lines.slice(i, i + 40);
      const res = (await browser.runtime.sendMessage({
        type: 'translate:batch',
        payload: {
          texts: chunkLines,
          from: 'auto',
          to: store.config.general.targetLanguage,
          service: store.config.general.service,
          scope: 'subtitle',
        },
      })) as { texts?: string[] };
      out.push(...(res?.texts ?? []));
      progress.value = `翻译中… ${Math.min(i + 40, lines.length)}/${lines.length}`;
    }

    // 生成双语输出：在原行下方插入译文行
    const all = raw.split(/\r?\n/);
    const insertAfter = new Map<number, string>();
    indexes.forEach((idx, k) => insertAfter.set(idx, out[k] ?? ''));
    const resultLines: string[] = [];
    all.forEach((line, i) => {
      resultLines.push(line);
      const tr = insertAfter.get(i);
      if (tr) resultLines.push(tr);
    });
    const output = resultLines.join('\n');
    preview.value = output.slice(0, 1500);

    const blob = new Blob([output], { type: 'text/plain;charset=utf-8' });
    outputBlobUrl.value = URL.createObjectURL(blob);
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    busy.value = false;
    progress.value = '';
  }
}

function download() {
  if (!outputBlobUrl.value) return;
  const a = document.createElement('a');
  a.href = outputBlobUrl.value;
  a.download = `${fileName.value.replace(/\.\w+$/, '')}.bilingual.${fileName.value.split('.').pop()}`;
  a.click();
}

onMounted(() => store.load());
</script>

<template>
  <div class="docs-tab">
    <div class="lang-row">
      <span class="hint">译为</span>
      <LangPicker
        :model-value="store.config.general.targetLanguage"
        style="flex: 1; width: auto"
        @update:model-value="store.patch({ general: { targetLanguage: $event } })"
      />
    </div>

    <div class="upload">
      <input type="file" accept=".txt,.html,.htm,.md,.json,.srt,.ass,.ssa,.vtt,.lrc" :disabled="busy" @change="onFileChosen" />
    </div>
    <p class="hint">
      支持 txt / html / md / json / 字幕（srt / ass / vtt / lrc）。翻译后输出双语对照文件（译文行紧跟原文行，时间轴保留）。
    </p>

    <div v-if="busy" class="status">{{ progress }}</div>
    <el-alert v-if="error" :title="`失败：${error}`" type="error" :closable="false" show-icon />
    <el-alert v-if="fileName && !busy && !error" :title="`已完成：${fileName}`" type="success" :closable="false" show-icon />

    <div v-if="preview" class="preview">
      <pre>{{ preview }}</pre>
      <el-button type="primary" size="small" @click="download">下载双语文件</el-button>
    </div>

    <p class="note">注：PDF 翻译（本地 PDF.js）与 EPUB 制作在裁剪清单中，暂不提供。</p>
  </div>
</template>

<style scoped>
.docs-tab { padding: 4px; font-size: 13px; }
.lang-row { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
.upload { border: 1px dashed var(--el-border-color); border-radius: 8px; padding: 18px; text-align: center; margin-bottom: 8px; }
.upload input { font-size: 13px; }
.hint { color: var(--el-text-color-secondary); margin: 6px 0; }
.status { color: var(--el-color-primary); margin: 8px 0; }
.preview pre {
  max-height: 260px; overflow: auto; background: var(--el-fill-color-lighter);
  padding: 10px; border-radius: 6px; font-size: 12px; white-space: pre-wrap; margin: 10px 0;
}
.note { color: var(--el-color-warning); font-size: 12px; margin-top: 14px; }
</style>
