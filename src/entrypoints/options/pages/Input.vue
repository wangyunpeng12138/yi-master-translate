<script setup lang="ts">
import { onMounted } from 'vue';
import { useConfigStore } from '@/core/config/ConfigStore';
import SettingRow from '@/components/SettingRow.vue';
import LangPicker from '@/components/LangPicker.vue';
import ServicePicker from '@/components/ServicePicker.vue';
import { runServiceTest } from '@/core/services/serviceTest';
import { ref } from 'vue';

const store = useConfigStore();
const testResult = ref('');
const testError = ref('');

async function testInputService() {
  testResult.value = '';
  testError.value = '';
  try {
    testResult.value = (await runServiceTest(store as never, 'input')) ?? '';
  } catch (e) {
    testError.value = e instanceof Error ? e.message : String(e);
  }
}

onMounted(() => store.load());
</script>

<template>
  <div>
    <h2 class="section-title">输入框翻译</h2>
    <el-alert
      title="启用后，在输入框中输入「你好世界」，再快速按空格键 3 次，即可将整个输入框翻译为默认目标语言"
      type="info"
      :closable="false"
      show-icon
      style="margin-bottom: 8px"
    />

    <SettingRow title="快速按空格键 3 次触发翻译" desc="输入内容后连续按触发键即可翻译整框文本">
      <el-switch :model-value="store.config.inputbox.enabled" @update:model-value="store.patch({ inputbox: { enabled: $event } })" />
    </SettingRow>

    <SettingRow title="触发键" desc="默认空格键，3 次判定窗口 200ms">
      <el-select
        :model-value="store.config.inputbox.triggerKey"
        style="width: 140px"
        @update:model-value="store.patch({ inputbox: { triggerKey: $event } })"
      >
        <el-option value="space" label="空格键" />
        <el-option value="enter" label="回车键" />
      </el-select>
    </SettingRow>

    <SettingRow title="触发次数" desc="连续按几次触发键执行翻译">
      <el-input-number
        :model-value="store.config.inputbox.repeat"
        :min="2" :max="5"
        @update:model-value="store.patch({ inputbox: { repeat: $event } })"
      />
    </SettingRow>

    <SettingRow title="触发判定间隔 (ms)" desc="相邻两次按键超过该间隔则重新计数">
      <el-input-number
        :model-value="store.config.inputbox.timeoutMs"
        :min="100" :max="1000" :step="50"
        @update:model-value="store.patch({ inputbox: { timeoutMs: $event } })"
      />
    </SettingRow>

    <h3>目标语言</h3>
    <SettingRow title="自动识别对话语言" desc="聊天、评论回复场景自动识别对方使用的语言（YouTube、Twitter、Telegram、WhatsApp、Reddit 等）">
      <el-switch :model-value="store.config.inputbox.autoDetectChatLang" @update:model-value="store.patch({ inputbox: { autoDetectChatLang: $event } })" />
    </SettingRow>
    <SettingRow title="自动识别页面语言" desc="浏览网页、搜索时按页面语言选择目标语言">
      <el-switch :model-value="store.config.inputbox.autoDetectPageLang" @update:model-value="store.patch({ inputbox: { autoDetectPageLang: $event } })" />
    </SettingRow>
    <SettingRow title="默认目标语言" desc="自动识别关闭时按此语言翻译">
      <LangPicker
        :model-value="store.config.inputbox.targetLanguage"
        @update:model-value="store.patch({ inputbox: { targetLanguage: $event } })"
      />
    </SettingRow>

    <SettingRow title="翻译服务" desc="输入框翻译可单独指定服务">
      <div style="display: flex; gap: 8px; align-items: center">
        <ServicePicker
          :model-value="store.config.inputbox.service"
          allow-inherit
          @update:model-value="store.patch({ inputbox: { service: $event } })"
        />
        <el-button size="small" text type="primary" @click="testInputService">测试服务</el-button>
      </div>
    </SettingRow>

    <el-alert v-if="testResult" :title="`测试成功：${testResult}`" type="success" :closable="false" show-icon style="margin-top: 12px" />
    <el-alert v-if="testError" :title="`测试失败：${testError}`" type="error" :closable="false" show-icon style="margin-top: 12px" />
  </div>
</template>

<style scoped>
.section-title { margin-top: 0; }
h3 { font-size: 15px; margin: 20px 0 4px; }
</style>
