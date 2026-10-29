<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useConfigStore } from '@/core/config/ConfigStore';
import { listServices } from '@/core/services/registry';
import { runServiceTest } from '@/core/services/serviceTest';

/** P10 起 AI/自定义服务已独立至「AI 服务」分区，本页只保留免费翻译服务 */
const store = useConfigStore();
const router = useRouter();
const testing = ref(false);
const testResult = ref('');
const testError = ref('');

const services = computed(() => listServices(store.config));
const freeGroup = computed(() => services.value.filter((s) => s.kind === 'machine' && !s.needsSetup));

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
    <el-alert type="info" :closable="false" show-icon style="margin-bottom: 10px">
      <template #title>
        AI 与自定义服务已独立分区，提供 Ollama / ChatGPT / DeepSeek / Kimi 预设模板
        <el-button size="small" text type="primary" @click="router.push('/ai_services')">前往 AI 服务 →</el-button>
      </template>
    </el-alert>

    <div v-if="testResult" style="margin-top: 16px">
      <el-alert :title="`测试成功：${testResult}`" type="success" :closable="false" show-icon />
    </div>
    <div v-if="testError" style="margin-top: 16px">
      <el-alert :title="`测试失败：${testError}`" type="error" :closable="false" show-icon />
    </div>
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
