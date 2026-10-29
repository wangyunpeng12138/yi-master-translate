<script setup lang="ts">
import { onMounted, ref } from 'vue';
import type { TermLibrary } from '@/core/shared/types';
import { useConfigStore } from '@/core/config/ConfigStore';
import SettingRow from '@/components/SettingRow.vue';

const store = useConfigStore();
const dialogOpen = ref(false);
const currentLib = ref<TermLibrary>({ id: '', name: '', enabled: true, terms: [] });
const termDialogOpen = ref(false);
const currentTerm = ref({ from: '', to: '' });

function openCreate() {
  currentLib.value = { id: `lib-${Date.now().toString(36)}`, name: '', enabled: true, terms: [] };
  dialogOpen.value = true;
}

function openEdit(lib: TermLibrary) {
  currentLib.value = JSON.parse(JSON.stringify(lib)) as TermLibrary;
  dialogOpen.value = true;
}

async function saveLib() {
  if (!currentLib.value.name.trim()) return;
  const list = store.config.terms.libraries.map((l) => (l.id === currentLib.value.id ? currentLib.value : l));
  if (!list.some((l) => l.id === currentLib.value.id)) list.push(currentLib.value);
  await store.patch({ terms: { libraries: list } });
  dialogOpen.value = false;
}

async function removeLib(id: string) {
  await store.patch({ terms: { libraries: store.config.terms.libraries.filter((l) => l.id !== id) } });
}

async function toggleLib(lib: TermLibrary, enabled: boolean) {
  const list = store.config.terms.libraries.map((l) => (l.id === lib.id ? { ...l, enabled } : l));
  await store.patch({ terms: { libraries: list } });
}

function addTerm() {
  currentTerm.value = { from: '', to: '' };
  termDialogOpen.value = true;
}

function saveTerm() {
  if (!currentTerm.value.from.trim() || !currentTerm.value.to.trim()) return;
  currentLib.value.terms.push({ ...currentTerm.value });
  termDialogOpen.value = false;
}

onMounted(() => store.load());
</script>

<template>
  <div>
    <h2 class="section-title">AI 术语库</h2>
    <el-alert
      title="术语库在翻译时固定特定词汇的译法，保持全文一致。仅 AI 翻译服务生效（机器翻译采用占位符替换，可能影响自然度）"
      type="info" :closable="false" show-icon style="margin-bottom: 8px"
    />

    <SettingRow title="显示已生效术语" desc="双语模式下高亮译文中已生效的术语；选中译文文字可手动添加（原版配置默认关）">
      <el-switch
        :model-value="store.config.terms.showActiveHighlights"
        @update:model-value="store.patch({ terms: { showActiveHighlights: $event } })"
      />
    </SettingRow>

    <h3>术语库列表</h3>
    <el-table :data="store.config.terms.libraries" size="small" row-key="id">
      <el-table-column label="启用" width="70">
        <template #default="{ row }">
          <el-switch size="small" :model-value="row.enabled" @update:model-value="toggleLib(row, $event)" />
        </template>
      </el-table-column>
      <el-table-column prop="name" label="名称" width="180" />
      <el-table-column label="词条数" width="80">
        <template #default="{ row }">{{ row.terms.length }}</template>
      </el-table-column>
      <el-table-column label="操作" width="140">
        <template #default="{ row }">
          <el-button size="small" text @click="openEdit(row)">编辑</el-button>
          <el-button size="small" text type="danger" @click="removeLib(row.id)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>
    <el-button style="margin-top: 10px" @click="openCreate">新建术语库</el-button>

    <el-dialog v-model="dialogOpen" :title="`术语库：${currentLib.name || '未命名'}`" width="640">
      <el-form label-width="70" inline>
        <el-form-item label="名称">
          <el-input v-model="currentLib.name" style="width: 360px" />
        </el-form-item>
      </el-form>
      <el-table :data="currentLib.terms" size="small" max-height="320">
        <el-table-column prop="from" label="原文" min-width="160" />
        <el-table-column prop="to" label="译文" min-width="160" />
        <el-table-column label="操作" width="80">
          <template #default="{ $index }">
            <el-button size="small" text type="danger" @click="currentLib.terms.splice($index, 1)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
      <el-button style="margin-top: 8px" size="small" @click="addTerm">添加词条</el-button>
      <template #footer>
        <el-button @click="dialogOpen = false">取消</el-button>
        <el-button type="primary" @click="saveLib">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="termDialogOpen" title="添加词条" width="380" append-to-body>
      <el-form label-width="60">
        <el-form-item label="原文"><el-input v-model="currentTerm.from" placeholder="LLM" /></el-form-item>
        <el-form-item label="译文"><el-input v-model="currentTerm.to" placeholder="大语言模型" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="termDialogOpen = false">取消</el-button>
        <el-button type="primary" @click="saveTerm">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.section-title { margin-top: 0; }
h3 { font-size: 15px; margin: 18px 0 8px; }
</style>
