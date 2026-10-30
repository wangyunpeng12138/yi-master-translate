<script setup lang="ts">
import { onMounted, ref } from 'vue';
import zhCn from 'element-plus/es/locale/lang/zh-cn';
import { useConfigStore } from '@/core/config/ConfigStore';
import LangPicker from '@/components/LangPicker.vue';

/**
 * AI Write 独立写作面板（P8c）
 * - 润色：AI 优化表达（保持原语言）
 * - 翻译写作：译成目标语言
 * 由自定义 AI 服务驱动（openai-compatible），快捷键 openAiWritingModal 可呼出
 */

const store = useConfigStore();
const text = ref('');
const targetLang = ref('en');
const result = ref('');
const error = ref('');
const busy = ref<'polish' | 'translate' | null>(null);
const hasCustom = ref(false);

async function run(mode: 'polish' | 'translate') {
  if (!text.value.trim()) return;
  busy.value = mode;
  result.value = '';
  error.value = '';
  try {
    const res = (await browser.runtime.sendMessage({
      type: 'ai:write',
      payload: { text: text.value, mode, to: mode === 'translate' ? targetLang.value : '' },
    })) as { text?: string };
    result.value = res?.text ?? '';
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    busy.value = null;
  }
}

onMounted(async () => {
  await store.load();
  hasCustom.value = store.config.customServices.length > 0;
});
</script>

<template>
  <el-config-provider :locale="zhCn">
    <div class="aiwrite-shell">
      <h2>AI Write <el-tag size="small" type="info">译大师</el-tag></h2>
    <el-alert
      v-if="!hasCustom"
      title="尚未配置 AI 服务：请先到「AI 服务」分区添加服务（预设模板或 API Key + 模型），AI Write 才能工作"
      type="warning" :closable="false" show-icon style="margin-bottom: 12px"
    />

    <el-input
      v-model="text"
      type="textarea"
      :rows="8"
      placeholder="输入或粘贴草稿…（支持中文写英文邮件、英文润色等）"
    />

    <div class="ops">
      <el-button type="primary" :loading="busy === 'polish'" :disabled="!hasCustom" @click="run('polish')">
        AI 润色
      </el-button>
      <LangPicker v-model="targetLang" style="width: 200px" />
      <el-button type="success" :loading="busy === 'translate'" :disabled="!hasCustom" @click="run('translate')">
        翻译写作
      </el-button>
      <el-button text @click="result = ''">清空结果</el-button>
    </div>

    <el-alert v-if="error" :title="`失败：${error}`" type="error" :closable="false" show-icon style="margin-bottom: 12px" />
    <el-input v-if="result" :model-value="result" type="textarea" :rows="10" readonly />
    </div>
  </el-config-provider>
</template>

<style scoped>
.aiwrite-shell {
  max-width: 780px;
  margin: 24px auto;
  padding: 0 16px;
}
h2 { display: flex; align-items: center; gap: 8px; }
.ops { display: flex; gap: 12px; align-items: center; margin: 14px 0; }
</style>
