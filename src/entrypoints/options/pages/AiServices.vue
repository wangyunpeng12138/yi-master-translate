<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import type { CustomAiService } from '@/core/shared/types';
import { useConfigStore } from '@/core/config/ConfigStore';
import { runServiceTest } from '@/core/services/serviceTest';
import { isLocalUrl } from '@/core/services/adapters/openai-compatible';

/**
 * AI 服务（独立分区，P10 从「翻译服务」拆出）
 * - 常见服务预设模板：Ollama / ChatGPT / DeepSeek / Kimi，选预设后只需填 API Key
 *   （Ollama 本地服务连 Key 都不用填），模型预填可直接改
 * - 自定义服务：逐项完整配置（地址/模型/温度/限速/请求体模板）
 */

type PresetKey = 'ollama' | 'openai' | 'deepseek' | 'kimi' | 'custom';

interface PresetDef {
  label: string;
  apiUrl: string;
  model: string;
  local?: boolean;
  keyHint?: string;
  keyPlaceholder?: string;
}

const PRESETS: Record<PresetKey, PresetDef> = {
  ollama: {
    label: 'Ollama（本地）',
    apiUrl: 'http://127.0.0.1:11434/v1/chat/completions',
    model: 'qwen2.5:7b',
    local: true,
    keyHint: '本地服务无需 API Key，名称填好直接保存即可',
    keyPlaceholder: '无需填写',
  },
  openai: {
    label: 'ChatGPT（OpenAI）',
    apiUrl: 'https://api.openai.com/v1/chat/completions',
    model: 'gpt-4o-mini',
    keyPlaceholder: 'sk-...',
  },
  deepseek: {
    label: 'DeepSeek',
    apiUrl: 'https://api.deepseek.com/v1/chat/completions',
    model: 'deepseek-chat',
    keyPlaceholder: 'sk-...',
  },
  kimi: {
    label: 'Kimi（Moonshot）',
    apiUrl: 'https://api.moonshot.cn/v1/chat/completions',
    model: 'moonshot-v1-8k',
    keyPlaceholder: 'sk-...',
  },
  custom: { label: '自定义服务', apiUrl: '', model: '' },
};

const store = useConfigStore();
const testing = ref(false);
const testResult = ref('');
const testError = ref('');
const dialogOpen = ref(false);
const editingIndex = ref(-1);
const presetKey = ref<PresetKey>('ollama');

const form = reactive<CustomAiService>({
  id: '',
  name: '',
  apiKey: '',
  apiUrl: '',
  model: '',
  temperature: 0,
  maxRps: 5,
});

/** 自定义模式（或编辑已有服务）显示完整字段；预设模式只露 名称/Key/模型 */
const isCustomForm = computed(() => presetKey.value === 'custom');
const currentPreset = computed(() => PRESETS[presetKey.value]);

function resetForm() {
  Object.assign(form, {
    id: `custom-${Date.now().toString(36)}`,
    name: '',
    apiKey: '',
    apiUrl: '',
    model: '',
    temperature: 0,
    maxRps: 5,
    requestBodyTemplate: undefined,
    systemPrompt: undefined,
    userPrompt: undefined,
  });
}

function selectPreset(key: PresetKey) {
  presetKey.value = key;
  const p = PRESETS[key];
  resetForm();
  form.name = key === 'custom' ? '' : p.label;
  form.apiUrl = p.apiUrl;
  form.model = p.model;
}

function openAdd() {
  editingIndex.value = -1;
  selectPreset('ollama');
  dialogOpen.value = true;
}

function openEdit(index: number) {
  editingIndex.value = index;
  presetKey.value = 'custom'; // 编辑走完整表单
  resetForm();
  Object.assign(form, store.config.customServices[index]);
  dialogOpen.value = true;
}

async function saveForm() {
  const isLocal = isLocalUrl(form.apiUrl);
  if (!form.name.trim()) {
    ElMessage.warning('请填写服务名称');
    return;
  }
  if (!form.apiUrl.trim()) {
    ElMessage.warning('请填写 API 接口地址');
    return;
  }
  if (!form.model.trim()) {
    ElMessage.warning('请填写模型名称（Ollama 可用 ollama list 查看）');
    return;
  }
  if (!isLocal && !form.apiKey.trim()) {
    ElMessage.warning('该服务需要 API Key（仅本地地址如 Ollama 可留空）');
    return;
  }
  const list = [...store.config.customServices];
  const record: CustomAiService = { ...form };
  if (editingIndex.value >= 0) list[editingIndex.value] = record;
  else list.push(record);
  await store.patch({ customServices: list });
  dialogOpen.value = false;
  ElMessage.success(editingIndex.value >= 0 ? '已保存' : `已添加「${record.name}」`);
}

async function removeCustom(index: number) {
  const list = store.config.customServices.filter((_, i) => i !== index);
  await store.patch({ customServices: list });
}

async function testService(id: string) {
  testing.value = true;
  testResult.value = '';
  testError.value = '';
  try {
    const text = await runServiceTest(
      { config: store.config } as never,
      id === 'inherit' ? store.config.general.service : id,
    );
    testResult.value = text ?? '(空结果)';
  } catch (e) {
    testError.value = e instanceof Error ? e.message : String(e);
  } finally {
    testing.value = false;
  }
}

function isLocal(c: CustomAiService): boolean {
  return isLocalUrl(c.apiUrl);
}

onMounted(() => store.load());
</script>

<template>
  <div>
    <h2 class="section-title">AI 服务</h2>

    <el-alert
      title="在此添加和管理 AI 翻译/解释服务。选择常见服务预设（Ollama/ChatGPT/DeepSeek/Kimi）后只需填写 API Key；本地 Ollama 无需 Key。保存后点击「测试」验证连通性"
      type="info" :closable="false" show-icon style="margin-bottom: 10px"
    />

    <div class="service-grid">
      <div
        v-for="(c, i) in store.config.customServices"
        :key="c.id"
        class="service-card"
        :class="{ active: store.config.general.service === c.id }"
      >
        <div class="card-head">
          <span>{{ c.name || c.id }}</span>
          <el-tag size="small" :type="isLocal(c) ? 'success' : 'warning'">
            {{ isLocal(c) ? '本地' : 'AI' }}
          </el-tag>
        </div>
        <div class="card-desc">{{ c.model }} · {{ c.apiUrl }}</div>
        <div class="card-actions">
          <el-button size="small" :disabled="store.config.general.service === c.id" @click="store.patch({ general: { service: c.id } })">
            {{ store.config.general.service === c.id ? '当前默认' : '设为默认' }}
          </el-button>
          <el-button size="small" text type="primary" :loading="testing" @click="testService(c.id)">测试</el-button>
          <el-button size="small" text @click="openEdit(i)">编辑</el-button>
          <el-button size="small" text type="danger" @click="removeCustom(i)">删除</el-button>
        </div>
      </div>
      <div class="service-card add-card" @click="openAdd">
        <el-icon><Plus /></el-icon>
        <span>添加 AI 服务</span>
      </div>
    </div>

    <div v-if="testResult" style="margin-top: 16px">
      <el-alert :title="`测试成功：${testResult}`" type="success" :closable="false" show-icon />
    </div>
    <div v-if="testError" style="margin-top: 16px">
      <el-alert :title="`测试失败：${testError}`" type="error" :closable="false" show-icon />
    </div>

    <el-dialog v-model="dialogOpen" :title="editingIndex >= 0 ? '编辑 AI 服务' : '添加 AI 服务'" width="520">
      <el-form label-width="150" size="default">
        <!-- 预设选择（仅新增时；编辑一律完整表单） -->
        <el-form-item v-if="editingIndex < 0" label="服务类型">
          <el-select :model-value="presetKey" style="width: 100%" @change="selectPreset($event as PresetKey)">
            <el-option v-for="(p, k) in PRESETS" :key="k" :value="k" :label="p.label" />
          </el-select>
        </el-form-item>

        <el-form-item label="服务名称">
          <el-input v-model="form.name" placeholder="如 我的 DeepSeek" />
        </el-form-item>

        <el-form-item label="APIKEY">
          <div class="key-wrap">
            <el-input
              v-model="form.apiKey"
              type="password"
              show-password
              :placeholder="currentPreset.keyPlaceholder || 'sk-...'"
            />
            <div v-if="currentPreset.keyHint" class="key-hint">{{ currentPreset.keyHint }}</div>
          </div>
        </el-form-item>

        <el-form-item label="模型">
          <el-input v-model="form.model" :placeholder="isCustomForm ? 'deepseek-chat' : ''" />
        </el-form-item>

        <template v-if="isCustomForm">
          <el-form-item label="API 接口地址">
            <el-input v-model="form.apiUrl" placeholder="https://api.deepseek.com/v1/chat/completions（Base URL 会自动补全）" />
          </el-form-item>
          <el-form-item label="Temperature">
            <el-input-number v-model="form.temperature" :min="0" :max="2" :step="0.1" />
          </el-form-item>
          <el-form-item label="每秒最大请求数">
            <el-input-number v-model="form.maxRps" :min="1" :max="20" />
          </el-form-item>
          <el-form-item label="请求体模板(选填)">
            <el-input
              v-model="form.requestBodyTemplate"
              type="textarea"
              :rows="2"
              placeholder='{"thinking":{"type":"disabled"}}'
            />
          </el-form-item>
        </template>
        <div v-else class="preset-note">
          地址 {{ form.apiUrl }} · Temperature {{ form.temperature }} · 限速 {{ form.maxRps }}/秒，保存后可在「编辑」中调整
        </div>
      </el-form>
      <template #footer>
        <el-button @click="dialogOpen = false">取消</el-button>
        <el-button type="primary" @click="saveForm">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.section-title { margin-top: 0; }
.service-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}
.service-card {
  width: 300px;
  padding: 12px;
  border: 1px solid var(--el-border-color);
  border-radius: 8px;
  background: var(--el-bg-color);
}
.service-card.active {
  border-color: var(--el-color-success);
  box-shadow: 0 0 0 1px var(--el-color-success);
}
.card-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-weight: 500;
  margin-bottom: 6px;
}
.card-desc {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  margin-bottom: 8px;
  word-break: break-all;
}
.card-actions {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}
.add-card {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border-style: dashed;
  color: var(--el-text-color-secondary);
  cursor: pointer;
  min-height: 100px;
}
.add-card:hover { color: var(--el-color-primary); border-color: var(--el-color-primary); }
.key-wrap { width: 100%; }
.key-hint {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  line-height: 1.5;
  margin-top: 2px;
}
.preset-note {
  font-size: 12px;
  color: var(--el-text-color-placeholder);
  margin: 4px 0 0 150px;
}
</style>
