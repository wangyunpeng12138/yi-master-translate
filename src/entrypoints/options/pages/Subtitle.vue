<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { useConfigStore } from '@/core/config/ConfigStore';
import { listAsrProviders } from '@/core/asr';
import SettingRow from '@/components/SettingRow.vue';
import ServicePicker from '@/components/ServicePicker.vue';

/**
 * 视频字幕设置
 * - 上半部分：有字幕轨的翻译（P8a）
 * - 下半部分：无字幕视频的 ASR（A1 云端已接入 / A2 本地 Whisper）
 *   provider 列表完全由 `listAsrProviders()` 的能力表生成，新增服务不需要改本页面。
 */
const store = useConfigStore();
onMounted(() => store.load());

const providers = computed(() =>
  listAsrProviders(store.config).map((p) => ({
    ...p,
    label: p.implemented ? `${p.name}${p.kind === 'local' ? '（本机）' : ''}` : p.name,
  })),
);

const current = computed(() => providers.value.find((p) => p.id === store.config.asr.cloud.provider));
const currentModelOptions = computed(() => current.value?.models ?? []);

const testing = ref(false);
async function testAsr() {
  testing.value = true;
  try {
    const res = (await browser.runtime.sendMessage({
      type: 'asr:test',
      payload: { provider: 'auto' },
    })) as { ok: boolean; provider?: string; ms?: number; message?: string };
    if (res?.ok) ElMessage.success(`连接成功：${res.provider}（${res.ms}ms）`);
    else ElMessage.error(`连接失败：${res?.message ?? '未知错误'}`);
  } catch (e) {
    ElMessage.error(`连接失败：${(e as Error).message}`);
  } finally {
    testing.value = false;
  }
}

async function clearCache() {
  try {
    await ElMessageBox.confirm('清空已缓存的语音识别结果？（不影响翻译缓存）', '确认', {
      type: 'warning',
    });
  } catch {
    return; // 用户取消
  }
  const res = (await browser.runtime.sendMessage({ type: 'asr:cache:clear', payload: {} })) as {
    removed?: number;
  };
  ElMessage.success(`已清除 ${res?.removed ?? 0} 条识别缓存`);
}
</script>

<template>
  <div>
    <h2 class="section-title">视频字幕</h2>
    <el-alert
      title="播放视频时显示双语字幕。有字幕轨的视频走「轨道拦截翻译」；没有字幕轨的视频可开启下方的语音识别（ASR）。"
      type="info" :closable="false" show-icon style="margin-bottom: 8px"
    />

    <SettingRow title="自动开启双语字幕" desc="已支持平台播放视频时自动翻译字幕（P8a 引擎：track 拦截方案）">
      <el-switch :model-value="store.config.subtitle.enabled" @update:model-value="store.patch({ subtitle: { enabled: $event } })" />
    </SettingRow>

    <SettingRow title="在播放器显示双语字幕快捷方式" desc="播放器右下角快捷开关（修改后刷新视频网页生效）">
      <el-switch :model-value="store.config.subtitle.showPlayerShortcut" @update:model-value="store.patch({ subtitle: { showPlayerShortcut: $event } })" />
    </SettingRow>

    <h3>YouTube 专属设置</h3>
    <SettingRow title="YouTube 自动开启双语字幕">
      <el-switch :model-value="store.config.subtitle.youtubeAuto" @update:model-value="store.patch({ subtitle: { youtubeAuto: $event } })" />
    </SettingRow>
    <SettingRow title="优先使用本扩展翻译 YouTube 字幕" desc="开启则优先翻译字幕原文；关闭则优先使用 YouTube 自带机翻字幕轨">
      <el-switch :model-value="store.config.subtitle.youtubePreferImt" @update:model-value="store.patch({ subtitle: { youtubePreferImt: $event } })" />
    </SettingRow>

    <SettingRow title="会议平台自动开启双语字幕" desc="Teams、Zoom、Google Meet">
      <el-switch :model-value="store.config.subtitle.meetingAuto" @update:model-value="store.patch({ subtitle: { meetingAuto: $event } })" />
    </SettingRow>

    <SettingRow title="优先使用人工字幕" desc="视频有目标语言人工字幕时优先使用">
      <el-switch :model-value="store.config.subtitle.preferManualSubtitle" @update:model-value="store.patch({ subtitle: { preferManualSubtitle: $event } })" />
    </SettingRow>

    <SettingRow title="字幕专注于对话内容" desc="滤除环境声标注，如（呼噜声）（打雷声）">
      <el-switch :model-value="store.config.subtitle.focusDialogue" @update:model-value="store.patch({ subtitle: { focusDialogue: $event } })" />
    </SettingRow>

    <SettingRow title="视频字幕翻译服务" desc="为字幕单独指定翻译服务">
      <ServicePicker
        :model-value="store.config.subtitle.service"
        allow-inherit
        @update:model-value="store.patch({ subtitle: { service: $event } })"
      />
    </SettingRow>

    <SettingRow title="视频字幕显示模式">
      <el-radio-group
        :model-value="store.config.subtitle.displayMode"
        @update:model-value="store.patch({ subtitle: { displayMode: $event } })"
      >
        <el-radio-button value="dual" label="双语对照" />
        <el-radio-button value="only" label="仅译文" />
      </el-radio-group>
    </SettingRow>

    <SettingRow title="永久禁用视频字幕功能" desc="与其他扩展冲突时可彻底关闭">
      <el-switch :model-value="store.config.subtitle.permanentDisable" @update:model-value="store.patch({ subtitle: { permanentDisable: $event } })" />
    </SettingRow>

    <!-- ============ 无字幕视频（ASR） ============ -->
    <h3>无字幕视频（语音识别）</h3>
    <el-alert
      title="针对「视频本身没有字幕轨」的情况：先抽取音频做语音识别生成字幕，再翻译成双语。会消耗 CPU（本地）或流量（云端），默认关闭。"
      type="warning" :closable="false" show-icon style="margin-bottom: 8px"
    />

    <SettingRow title="为没有字幕的视频生成字幕" desc="总开关；关闭后不采集音频、不请求任何 ASR 服务">
      <el-switch :model-value="store.config.asr.enabled" @update:model-value="store.patch({ asr: { enabled: $event } })" />
    </SettingRow>

    <SettingRow title="识别方式" desc="列表由各 provider 的能力表生成，新增服务无需改本页面">
      <el-select
        :model-value="store.config.asr.cloud.provider"
        style="width: 280px"
        @update:model-value="store.patch({ asr: { cloud: { provider: $event } } })"
      >
        <el-option
          v-for="p in providers"
          :key="p.id"
          :label="p.label"
          :value="p.id"
          :disabled="!p.implemented"
        />
      </el-select>
    </SettingRow>

    <el-alert
      v-if="current && !current.implemented"
      type="info" :closable="false" show-icon
      :title="`${current.name} 将在 A2 阶段接入（本地 Whisper）。当前请先使用云端识别。`"
      style="margin-bottom: 8px"
    />

    <template v-if="current?.kind === 'cloud'">
      <SettingRow title="接口端点" :desc="`留空使用默认：${current.defaultEndpoint || '（无默认，必须填写）'}`">
        <el-input
          :model-value="store.config.asr.cloud.endpoint"
          :placeholder="current.defaultEndpoint"
          style="width: 340px"
          @update:model-value="store.patch({ asr: { cloud: { endpoint: $event } } })"
        />
      </SettingRow>

      <SettingRow v-if="current.needsKey" title="API Key" desc="仅存本机 storage.local，不参与配置导出">
        <el-input
          :model-value="store.config.asr.cloud.apiKey"
          type="password" show-password placeholder="sk-..."
          style="width: 340px"
          @update:model-value="store.patch({ asr: { cloud: { apiKey: $event } } })"
        />
      </SettingRow>

      <SettingRow title="模型">
        <el-select
          v-if="currentModelOptions.length"
          :model-value="store.config.asr.cloud.model"
          style="width: 280px"
          @update:model-value="store.patch({ asr: { cloud: { model: $event } } })"
        >
          <el-option v-for="m in currentModelOptions" :key="m" :label="m" :value="m" />
        </el-select>
        <el-input
          v-else
          :model-value="store.config.asr.cloud.model"
          placeholder="whisper-1 / base ..."
          style="width: 280px"
          @update:model-value="store.patch({ asr: { cloud: { model: $event } } })"
        />
      </SettingRow>

      <SettingRow title="识别语言" desc="auto = 由服务自动检测；指定可减少误判">
        <el-input
          :model-value="store.config.asr.cloud.language"
          placeholder="auto / en / zh / ja ..."
          style="width: 200px"
          @update:model-value="store.patch({ asr: { cloud: { language: $event } } })"
        />
      </SettingRow>

      <SettingRow title="单次切片时长" desc="超出上限的音频自动切片；单位分钟（默认 10）">
        <el-input-number
          :model-value="store.config.asr.cloud.chunkMinutes"
          :min="1" :max="30"
          @update:model-value="store.patch({ asr: { cloud: { chunkMinutes: Number($event) } } })"
        />
      </SettingRow>

      <SettingRow title="请求超时" desc="单位毫秒，默认 120000">
        <el-input-number
          :model-value="store.config.asr.cloud.timeoutMs"
          :min="10000" :max="600000" :step="10000"
          @update:model-value="store.patch({ asr: { cloud: { timeoutMs: Number($event) } } })"
        />
      </SettingRow>

      <SettingRow title="测试连接" desc="用 0.3 秒静音探测端点是否可用（不评判识别质量）">
        <el-button :loading="testing" @click="testAsr">测试</el-button>
      </SettingRow>
    </template>

    <SettingRow title="检测到无字幕时自动识别" desc="关闭后只处理有字幕轨的视频（手动触发放 A3）">
      <el-switch :model-value="store.config.asr.auto.whenNoTrack" @update:model-value="store.patch({ asr: { auto: { whenNoTrack: $event } } })" />
    </SettingRow>

    <SettingRow title="播放多久后开始识别" desc="避免划走就起任务；单位秒">
      <el-input-number
        :model-value="store.config.asr.auto.minWatchSeconds"
        :min="1" :max="120"
        @update:model-value="store.patch({ asr: { auto: { minWatchSeconds: Number($event) } } })"
      />
    </SettingRow>

    <SettingRow title="识别后自动翻译" desc="关闭则只显示识别出的原文">
      <el-switch :model-value="store.config.asr.pipeline.translate" @update:model-value="store.patch({ asr: { pipeline: { translate: $event } } })" />
    </SettingRow>

    <SettingRow title="识别结果缓存" desc="同一段音频重复观看时直接复用，避免重复计费/耗电">
      <div class="row-inline">
        <el-switch :model-value="store.config.asr.cache.enabled" @update:model-value="store.patch({ asr: { cache: { enabled: $event } } })" />
        <el-button text @click="clearCache">清空缓存</el-button>
      </div>
    </SettingRow>
  </div>
</template>

<style scoped>
.section-title { margin-top: 0; }
h3 { font-size: 15px; margin: 18px 0 4px; }
.row-inline { display: flex; align-items: center; gap: 12px; }
</style>
