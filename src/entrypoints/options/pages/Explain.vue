<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useConfigStore } from '@/core/config/ConfigStore';
import SettingRow from '@/components/SettingRow.vue';
import ServicePicker from '@/components/ServicePicker.vue';

const store = useConfigStore();
const exporting = ref(false);
const clearing = ref(false);
const exportCount = ref<number | null>(null);
const clearCount = ref<number | null>(null);

onMounted(() => store.load());

async function exportTxt() {
  exporting.value = true;
  exportCount.value = null;
  try {
    const r = (await browser.runtime.sendMessage({ type: 'explain:export' })) as {
      text?: string;
      count?: number;
    };
    if (!r?.text) {
      exportCount.value = 0;
      return;
    }
    exportCount.value = r.count ?? 0;
    const blob = new Blob([`\ufeff${r.text}`], { type: 'text/plain;charset=utf-8' }); // BOM 防 Excel/记事本乱码
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `术语解释_${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  } finally {
    exporting.value = false;
  }
}

async function clearCache() {
  clearing.value = true;
  clearCount.value = null;
  try {
    const r = (await browser.runtime.sendMessage({ type: 'explain:clear' })) as { removed?: number };
    clearCount.value = r?.removed ?? 0;
  } finally {
    clearing.value = false;
  }
}
</script>

<template>
  <div>
    <h2 class="section-title">AI 搜索（术语解释）</h2>

    <el-alert
      title="翻译后每个段落末尾会出现 🔍 按钮，点击即对本段做术语/典故科普解释。AI 搜索与翻译服务相互独立：机翻速度快但没有解释能力，请为本功能选择 AI 服务"
      type="info" :closable="false" show-icon style="margin-bottom: 16px"
    />

    <SettingRow title="启用段落 AI 搜索按钮" desc="译文渲染后在段落末尾显示 🔍，点击展开/收起解释">
      <el-switch
        :model-value="store.config.explain.enabled"
        @update:model-value="store.patch({ explain: { enabled: $event } })"
      />
    </SettingRow>

    <SettingRow title="AI 搜索服务" desc="解释术语必须用 AI 服务（默认跟随翻译服务；若翻译走机翻请在此单独指定）">
      <ServicePicker
        :model-value="store.config.explain.service"
        allow-inherit
        style="flex: 1; width: auto"
        @update:model-value="store.patch({ explain: { service: $event } })"
      />
    </SettingRow>

    <SettingRow title="解释缓存天数" desc="缓存命中直接返回（0 = 不缓存）。缓存按段落文本+服务维度存储">
      <el-input-number
        :model-value="store.config.explain.cacheDays"
        :min="0" :max="365" :step="1"
        @update:model-value="store.patch({ explain: { cacheDays: $event } })"
      />
    </SettingRow>

    <SettingRow title="导出术语解释" desc="把已缓存的全部段落解释导出为 txt（按生成时间排序，供复盘学习）">
      <div>
        <el-button size="small" type="primary" :loading="exporting" @click="exportTxt">导出 txt</el-button>
        <span v-if="exportCount !== null" class="op-note">已导出 {{ exportCount }} 条</span>
      </div>
    </SettingRow>

    <SettingRow title="清除解释缓存" desc="删除全部段落解释缓存（不影响翻译缓存）">
      <div>
        <el-button size="small" :loading="clearing" @click="clearCache">清除</el-button>
        <span v-if="clearCount !== null" class="op-note">已清除 {{ clearCount }} 条</span>
      </div>
    </SettingRow>
  </div>
</template>

<style scoped>
.section-title { margin-top: 0; }
.op-note { margin-left: 10px; font-size: 12px; color: var(--el-text-color-secondary); }
</style>
