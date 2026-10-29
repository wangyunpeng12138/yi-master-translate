<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useConfigStore } from '@/core/config/ConfigStore';
import { diffPatch } from '@/core/config/merge';
import { DEFAULT_CONFIG } from '@/core/config/defaults';

const store = useConfigStore();
const includeTerms = ref(true);
const importError = ref('');
const importOk = ref('');

/** 导出：用户配置差集（+ 可选术语库）下载为 JSON 文件 */
function exportConfig() {
  const userPatch = diffPatch(DEFAULT_CONFIG, store.config);
  const payload = {
    format: 'imt-rebuild/config@1',
    exportedAt: new Date().toISOString(),
    includeTerms,
    config: userPatch,
    terms: includeTerms ? store.config.terms.libraries : undefined,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `imt-rebuild-config-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/** 导入：支持本工程格式与原版导出格式（常见键做映射） */
async function importConfig(file: File) {
  importError.value = '';
  importOk.value = '';
  try {
    const raw = JSON.parse(await file.text()) as Record<string, unknown>;
    const patch = (raw.config ?? raw) as Record<string, unknown>;
    // 原版常见键映射（translationService → general.service 等）
    const mapped: Record<string, unknown> = { ...patch };
    if ('translationService' in patch) {
      mapped.general = { ...((mapped.general as object) ?? {}), service: patch.translationService };
      delete mapped.translationService;
    }
    if ('translationMode' in patch) {
      mapped.general = { ...((mapped.general as object) ?? {}), displayMode: patch.translationMode };
      delete mapped.translationMode;
    }
    await store.patch(mapped as never);
    importOk.value = `导入成功（${Object.keys(mapped).length} 个顶层键）`;
    await store.load();
  } catch (e) {
    importError.value = e instanceof Error ? e.message : String(e);
  }
}

function onFileChosen(ev: Event) {
  const input = ev.target as HTMLInputElement;
  const file = input.files?.[0];
  if (file) void importConfig(file);
  input.value = '';
}

onMounted(() => store.load());
</script>

<template>
  <div>
    <h2 class="section-title">导入/导出配置</h2>

    <el-collapse style="margin-bottom: 16px">
      <el-collapse-item title="展开当前配置" name="config">
        <pre class="config-view">{{ JSON.stringify(store.config, null, 2) }}</pre>
      </el-collapse-item>
    </el-collapse>

    <h3>本地文件</h3>
    <div class="ops">
      <el-checkbox v-model="includeTerms">包含术语库</el-checkbox>
    </div>
    <div class="ops">
      <input type="file" accept=".json" class="native-file" @change="onFileChosen" />
      <el-button type="primary" @click="exportConfig"> 导出到文件 </el-button>
      <el-button text type="danger" @click="store.reset()">重置设置</el-button>
    </div>

    <el-alert v-if="importOk" :title="importOk" type="success" :closable="false" show-icon style="margin-top: 12px" />
    <el-alert v-if="importError" :title="`导入失败：${importError}`" type="error" :closable="false" show-icon style="margin-top: 12px" />

    <p class="hint">
      说明：云同步（Google Drive）已在裁剪清单中，本页仅提供本地文件导入/导出；导出内容为与默认值的差集，可跨设备导入。
    </p>
  </div>
</template>

<style scoped>
.section-title { margin-top: 0; }
h3 { font-size: 15px; margin: 18px 0 8px; }
.ops { display: flex; gap: 12px; align-items: center; margin: 8px 0; }
.native-file { font-size: 13px; color: var(--el-text-color-secondary); }
.config-view {
  max-height: 320px;
  overflow: auto;
  background: var(--el-fill-color-lighter);
  padding: 12px;
  border-radius: 6px;
  font-size: 12px;
}
.hint {
  color: var(--el-text-color-secondary);
  font-size: 13px;
  margin-top: 20px;
}
</style>
