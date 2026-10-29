<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import type { CustomAiService } from '@/core/shared/types';
import { useConfigStore } from '@/core/config/ConfigStore';
import { listServices } from '@/core/services/registry';
import { runServiceTest } from '@/core/services/serviceTest';

const store = useConfigStore();
const testing = ref(false);
const testResult = ref('');
const testError = ref('');
const dialogOpen = ref(false);
const editingIndex = ref(-1);

const form = reactive<CustomAiService>({
  id: '',
  name: '',
  apiKey: '',
  apiUrl: 'https://api.openai.com/v1/chat/completions',
  model: 'gpt-4o-mini',
  temperature: 0,
  maxRps: 5,
});

const services = computed(() => listServices(store.config));
const freeGroup = computed(() => services.value.filter((s) => s.kind === 'machine' && !s.needsSetup));

function openAdd() {
  editingIndex.value = -1;
  Object.assign(form, {
    id: `custom-${Date.now().toString(36)}`,
    name: '',
    apiKey: '',
    apiUrl: 'https://api.openai.com/v1/chat/completions',
    model: 'gpt-4o-mini',
    temperature: 0,
    maxRps: 5,
  });
  dialogOpen.value = true;
}

function openEdit(index: number) {
  editingIndex.value = index;
  Object.assign(form, store.config.customServices[index]);
  dialogOpen.value = true;
}

async function saveForm() {
  const list = [...store.config.customServices];
  const record: CustomAiService = { ...form };
  if (editingIndex.value >= 0) list[editingIndex.value] = record;
  else list.push(record);
  await store.patch({ customServices: list });
  dialogOpen.value = false;
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

onMounted(() => store.load());
</script>

<template>
  <div>
    <h2 class="section-title">翻译服务</h2>

    <h3>免费翻译服务</h3>
    <div class="service-grid">
      <div v-for="s in freeGroup" :key="s.id" class="service-card" :class="{ active: store.config.general.service === s.id }">
        <div class="card-head">
          <span>{{ s.name }}</span>
          <el-tag size="small" :type="s.kind === 'ai' ? 'warning' : 'info'">{{ s.kind === 'ai' ? 'AI' : '机器' }}</el-tag>
        </div>
        <div class="card-actions">
          <el-button
            size="small"
            :type="store.config.general.service === s.id ? 'success' : 'default'"
            :disabled="store.config.general.service === s.id"
            @click="store.patch({ general: { service: s.id } })"
          >
            {{ store.config.general.service === s.id ? '当前默认' : '设为默认' }}
          </el-button>
          <el-button size="small" text type="primary" :loading="testing" @click="testService(s.id)">测试</el-button>
        </div>
      </div>
    </div>

    <h3>AI / 自定义服务</h3>
    <el-alert
      title="添加 OpenAI 兼容服务后，点击卡片上的「测试」按钮可验证 API 连通性（会向该服务发送一句测试翻译请求）"
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
          <el-tag size="small" type="warning">AI</el-tag>
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
        <span>添加自定义翻译服务</span>
      </div>
    </div>

    <div v-if="testResult" style="margin-top: 16px">
      <el-alert :title="`测试成功：${testResult}`" type="success" :closable="false" show-icon />
    </div>
    <div v-if="testError" style="margin-top: 16px">
      <el-alert :title="`测试失败：${testError}`" type="error" :closable="false" show-icon />
    </div>

    <el-dialog v-model="dialogOpen" :title="editingIndex >= 0 ? '编辑自定义服务' : '添加自定义翻译服务'" width="520">
      <el-form label-width="150" size="default">
        <el-form-item label="服务名称">
          <el-input v-model="form.name" placeholder="如 我的 DeepSeek" />
        </el-form-item>
        <el-form-item label="APIKEY">
          <el-input v-model="form.apiKey" type="password" show-password placeholder="sk-..." />
        </el-form-item>
        <el-form-item label="API 接口地址">
          <el-input v-model="form.apiUrl" placeholder="https://api.deepseek.com/v1/chat/completions" />
        </el-form-item>
        <el-form-item label="模型">
          <el-input v-model="form.model" placeholder="deepseek-chat" />
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
h3 { font-size: 15px; margin: 20px 0 8px; }
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
</style>
