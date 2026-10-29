<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useConfigStore } from '@/core/config/ConfigStore';
import SettingRow from '@/components/SettingRow.vue';

const store = useConfigStore();
const dialogOpen = ref(false);
const editingIndex = ref(-1);
const form = ref({ id: '', name: '', prompt: '' });

function openAdd() {
  editingIndex.value = -1;
  form.value = { id: `expert-${Date.now().toString(36)}`, name: '', prompt: '' };
  dialogOpen.value = true;
}

function openEdit(i: number) {
  editingIndex.value = i;
  form.value = { ...store.config.ai.experts[i] };
  dialogOpen.value = true;
}

async function save() {
  const list = [...store.config.ai.experts];
  if (editingIndex.value >= 0) list[editingIndex.value] = { ...form.value };
  else list.push({ ...form.value });
  await store.patch({ ai: { experts: list } });
  dialogOpen.value = false;
}

async function remove(i: number) {
  const list = store.config.ai.experts.filter((_, x) => x !== i);
  const patch: Record<string, unknown> = { experts: list };
  if (store.config.ai.activeExpertId === store.config.ai.experts[i].id) patch.activeExpertId = 'general';
  await store.patch({ ai: patch as never });
}

onMounted(() => store.load());
</script>

<template>
  <div>
    <h2 class="section-title">AI 专家</h2>
    <el-alert
      title="为翻译指定领域专家角色，让译文风格贴合领域。专家提示词会注入 AI 服务的系统提示中（仅 AI 翻译服务生效）"
      type="info" :closable="false" show-icon style="margin-bottom: 8px"
    />

    <SettingRow title="启用 AI 专家" desc="翻译时附带专家角色提示词">
      <el-switch :model-value="store.config.ai.enabled" @update:model-value="store.patch({ ai: { enabled: $event } })" />
    </SettingRow>

    <SettingRow title="当前专家" desc="全局生效的专家角色">
      <el-select
        :model-value="store.config.ai.activeExpertId"
        style="width: 220px"
        @update:model-value="store.patch({ ai: { activeExpertId: $event } })"
      >
        <el-option v-for="e in store.config.ai.experts" :key="e.id" :value="e.id" :label="e.name" />
      </el-select>
    </SettingRow>

    <SettingRow
      title="自定义追加提示词"
      desc="注入 AI 服务系统提示词末尾的领域定制要求（与专家提示词叠加，仅 AI 服务生效）。如：金融文本请使用中国市场惯用术语"
    >
      <el-input
        :model-value="store.config.ai.promptAppend"
        type="textarea" :rows="3" style="width: 360px"
        placeholder="例如：请使用简体中文技术社区惯用译法；专有名词保留英文"
        @update:model-value="store.patch({ ai: { promptAppend: $event } })"
      />
    </SettingRow>

    <h3>专家列表</h3>
    <el-table :data="store.config.ai.experts" size="small" row-key="id">
      <el-table-column prop="name" label="名称" width="160" />
      <el-table-column prop="prompt" label="提示词" min-width="280" show-overflow-tooltip />
      <el-table-column label="操作" width="140">
        <template #default="{ $index }">
          <el-button size="small" text @click="openEdit($index)">编辑</el-button>
          <el-button size="small" text type="danger" @click="remove($index)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>
    <el-button style="margin-top: 10px" @click="openAdd">新建专家角色</el-button>

    <el-dialog v-model="dialogOpen" :title="editingIndex >= 0 ? '编辑专家' : '新建专家角色'" width="520">
      <el-form label-width="90">
        <el-form-item label="名称">
          <el-input v-model="form.name" placeholder="如 医学领域" />
        </el-form-item>
        <el-form-item label="提示词">
          <el-input v-model="form.prompt" type="textarea" :rows="4" placeholder="You are a professional medical translator. Use standard medical terminology..." />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogOpen = false">取消</el-button>
        <el-button type="primary" @click="save">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.section-title { margin-top: 0; }
h3 { font-size: 15px; margin: 18px 0 8px; }
</style>
