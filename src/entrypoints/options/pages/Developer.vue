<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useConfigStore } from '@/core/config/ConfigStore';
import SettingRow from '@/components/SettingRow.vue';

const store = useConfigStore();
const saveError = ref('');
const saveOk = ref('');

/** UserRules：JSON 数组，元素为 { id, matches, selectors?, excludeSelectors? } 站点覆盖 */
async function saveUserRules(text: string) {
  saveError.value = '';
  saveOk.value = '';
  try {
    if (text.trim()) JSON.parse(text); // 校验 JSON
    await store.patch({ developer: { userRules: text } });
    saveOk.value = '用户规则已保存';
  } catch (e) {
    saveError.value = `JSON 无效：${e instanceof Error ? e.message : String(e)}`;
  }
}

async function saveInjectedCss(text: string) {
  await store.patch({ developer: { injectedCss: text } });
  saveOk.value = '注入 CSS 已保存';
}

onMounted(() => store.load());
</script>

<template>
  <div>
    <h2 class="section-title">开发者设置</h2>

    <SettingRow title="在控制台打印调试日志" desc="内容脚本与后台输出 [imt-rebuild] 前缀日志">
      <el-switch :model-value="store.config.developer.debugLog" @update:model-value="store.patch({ developer: { debugLog: $event } })" />
    </SettingRow>

    <SettingRow title="开启 Beta 测试特性" desc="启用实验性功能">
      <el-switch :model-value="store.config.developer.beta" @update:model-value="store.patch({ developer: { beta: $event } })" />
    </SettingRow>

    <h3>Edit User Rules（站点识别规则覆盖）</h3>
    <el-input
      :model-value="store.config.developer.userRules"
      type="textarea" :rows="6" style="max-width: 720px"
      placeholder='[{"id":"example","matches":"example.com/article/*","selectors":[".post-body p"],"excludeSelectors":[".ad"]}]'
      @change="saveUserRules"
    />
    <p class="hint">JSON 数组；matches 支持 * 通配。命中站点的 selectors 优先于启发式段落识别。</p>

    <h3>Edit Injected CSS（注入页面的样式）</h3>
    <el-input
      :model-value="store.config.developer.injectedCss"
      type="textarea" :rows="5" style="max-width: 720px"
      placeholder=".imt-rebuild-target-wrapper { color: #1e80ff; }"
      @change="saveInjectedCss"
    />

    <h3>当前完整配置</h3>
    <el-collapse>
      <el-collapse-item title="展开最终配置（final config）" name="final">
        <pre class="config-view">{{ JSON.stringify(store.config, null, 2) }}</pre>
      </el-collapse-item>
    </el-collapse>

    <el-alert v-if="saveOk" :title="saveOk" type="success" :closable="false" show-icon style="margin-top: 12px" />
    <el-alert v-if="saveError" :title="saveError" type="error" :closable="false" show-icon style="margin-top: 12px" />
  </div>
</template>

<style scoped>
.section-title { margin-top: 0; }
h3 { font-size: 15px; margin: 20px 0 8px; }
.hint { color: var(--el-text-color-secondary); font-size: 12px; margin: 6px 0 0; }
.config-view {
  max-height: 320px; overflow: auto;
  background: var(--el-fill-color-lighter); padding: 12px; border-radius: 6px; font-size: 12px;
}
</style>
