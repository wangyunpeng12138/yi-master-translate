<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
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

const providers = computed(() =>
  listAsrProviders(store.config).map((p) => ({
    ...p,
    label: p.implemented ? `${p.name}${p.kind === 'local' ? '（本机）' : ''}` : p.name,
  })),
);

const selected = computed(() => store.config.asr.provider);
const isAuto = computed(() => selected.value === 'auto');
/** 本地卡片：选中本地，或 auto（本地优先） */
const showLocal = computed(() => {
  if (isAuto.value) return true;
  return providers.value.find((p) => p.id === selected.value)?.kind === 'local';
});
/** 云端卡片：选中云端，或 auto（本地不可用时的回退者） */
const showCloud = computed(() => {
  if (isAuto.value) return true;
  return providers.value.find((p) => p.id === selected.value)?.kind === 'cloud';
});
const current = computed(() => providers.value.find((p) => p.id === store.config.asr.cloud.provider));
const currentModelOptions = computed(() => current.value?.models ?? []);

/** 识别方式变更：本地/自动只改 asr.provider；云端同时把该 provider 记为云端主服务 */
function pickProvider(id: unknown) {
  const value = String(id);
  if (value === 'auto' || value === 'local-whisper') {
    void store.patch({ asr: { provider: value } as never });
  } else {
    void store.patch({ asr: { provider: value, cloud: { ...store.config.asr.cloud, provider: value } } as never });
  }
}

/* ---------- 本地模型管理（A2） ---------- */
const localState = ref<{ status: string; ratio?: number; sizeMB?: number; error?: string }>({ status: 'absent' });
const localBusy = ref(false);
let pollTimer: number | undefined;

async function refreshLocal() {
  try {
    localState.value = (await browser.runtime.sendMessage({
      type: 'asr:model',
      payload: { action: 'status', model: store.config.asr.local.model },
    })) as typeof localState.value;
  } catch {
    localState.value = { status: 'absent' };
  }
}

async function downloadLocal() {
  localBusy.value = true;
  try {
    localState.value = (await browser.runtime.sendMessage({
      type: 'asr:model',
      payload: { action: 'download', model: store.config.asr.local.model },
    })) as typeof localState.value;
    ElMessage.info('已开始下载模型，首次约 40–250MB，可继续使用其它功能');
    window.clearInterval(pollTimer);
    pollTimer = window.setInterval(async () => {
      await refreshLocal();
      if (localState.value.status !== 'downloading') window.clearInterval(pollTimer);
    }, 1000);
  } finally {
    localBusy.value = false;
  }
}

async function removeLocal() {
  try {
    await ElMessageBox.confirm('删除已下载的本地模型？下次使用需重新下载。', '确认', { type: 'warning' });
  } catch {
    return;
  }
  localState.value = (await browser.runtime.sendMessage({
    type: 'asr:model',
    payload: { action: 'remove', model: store.config.asr.local.model },
  })) as typeof localState.value;
  ElMessage.success('模型已删除');
}

const localStatusText = computed(() => {
  const s = localState.value;
  if (s.status === 'ready') return '已就绪（离线可用）';
  if (s.status === 'downloading') return `下载中 ${Math.round((s.ratio ?? 0) * 100)}%`;
  if (s.status === 'error') return `失败：${s.error ?? '未知错误'}`;
  return '未下载';
});

/* ---------- 模型来源预设（HF / ModelScope / hf-mirror） ---------- */
const LOCAL_PRESETS = {
  hf: { modelBaseUrl: '', modelRevision: 'main' },
  modelscope: { modelBaseUrl: 'https://www.modelscope.cn/models', modelRevision: 'master' },
  hfm: { modelBaseUrl: 'https://hf-mirror.com', modelRevision: 'main' },
} as const;

const localPreset = computed(() => {
  const base = store.config.asr.local.modelBaseUrl;
  if (!base) return 'hf';
  if (base.includes('modelscope.cn')) return 'modelscope';
  if (base.includes('hf-mirror.com')) return 'hfm';
  return 'custom';
});

function applyLocalPreset(key: string) {
  const preset = (LOCAL_PRESETS as Record<string, { modelBaseUrl: string; modelRevision: string }>)[key];
  if (!preset) return; // 'custom'：保持用户手填
  void store.patch({
    asr: { local: { ...store.config.asr.local, ...preset } },
  });
  void refreshLocal();
}

onMounted(async () => {
  await store.load();
  await refreshLocal();
});
onUnmounted(() => window.clearInterval(pollTimer));

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

    <SettingRow title="在播放器显示双语字幕快捷方式" desc="播放器控制条上的「CC」按钮：点开可单独开关该视频的字幕（修改后刷新视频网页生效）">
      <el-switch :model-value="store.config.subtitle.showPlayerShortcut" @update:model-value="store.patch({ subtitle: { showPlayerShortcut: $event } })" />
    </SettingRow>

    <SettingRow title="字幕译文位置" desc="播放器快捷面板里也可以改">
      <el-radio-group
        :model-value="store.config.subtitle.translationPosition"
        @update:model-value="store.patch({ subtitle: { translationPosition: $event } })"
      >
        <el-radio-button value="below" label="原文下方" />
        <el-radio-button value="above" label="原文上方" />
      </el-radio-group>
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
        :model-value="selected"
        style="width: 300px"
        @update:model-value="pickProvider($event)"
      >
        <el-option label="自动（本机优先，失败回退云端）" value="auto" />
        <el-option
          v-for="p in providers"
          :key="p.id"
          :label="p.label"
          :value="p.id"
          :disabled="!p.implemented"
        />
      </el-select>
    </SettingRow>

    <!-- 本地模型（本机推理，离线可用） -->
    <template v-if="showLocal">
      <SettingRow title="本地模型" desc="模型不随扩展分发：首次使用需下载，之后完全离线">
        <div class="row-inline">
          <el-select
            :model-value="store.config.asr.local.model"
            style="width: 200px"
            @update:model-value="store.patch({ asr: { local: { ...store.config.asr.local, model: $event } } })"
          >
            <el-option label="whisper-tiny（约 40MB，最快）" value="whisper-tiny" />
            <el-option label="whisper-base（约 80MB，推荐）" value="whisper-base" />
            <el-option label="whisper-small（约 250MB，中文更好）" value="whisper-small" />
          </el-select>
          <el-select
            :model-value="store.config.asr.local.dtype"
            style="width: 110px"
            @update:model-value="store.patch({ asr: { local: { ...store.config.asr.local, dtype: $event } } })"
          >
            <el-option label="q8" value="q8" />
            <el-option label="fp16" value="fp16" />
            <el-option label="fp32" value="fp32" />
          </el-select>
        </div>
      </SettingRow>

      <SettingRow title="模型状态" :desc="`${localStatusText}；单线程 wasm（扩展环境无跨源隔离）`">
        <div class="row-inline">
          <el-button
            v-if="localState.status !== 'ready'"
            type="primary" :loading="localBusy || localState.status === 'downloading'"
            @click="downloadLocal"
          >
            下载模型
          </el-button>
          <template v-else>
            <el-button @click="removeLocal">删除模型</el-button>
            <span class="ok-hint">✓ 可离线识别</span>
          </template>
        </div>
      </SettingRow>

      <el-progress
        v-if="localState.status === 'downloading'"
        :percentage="Math.round((localState.ratio ?? 0) * 100)"
        :stroke-width="8"
        style="margin: 0 4px 12px"
      />

      <SettingRow title="模型来源" desc="留空 = HuggingFace 官方；国内推荐 ModelScope（revision 填 master）或 hf-mirror（revision 填 main）">
        <div class="row-inline">
          <el-select
            :model-value="localPreset"
            style="width: 150px"
            @update:model-value="applyLocalPreset(String($event))"
          >
            <el-option label="HuggingFace" value="hf" />
            <el-option label="ModelScope" value="modelscope" />
            <el-option label="hf-mirror" value="hfm" />
            <el-option label="自定义" value="custom" />
          </el-select>
          <el-input
            :model-value="store.config.asr.local.modelBaseUrl"
            placeholder="https://www.modelscope.cn/models"
            style="width: 260px"
            @update:model-value="store.patch({ asr: { local: { ...store.config.asr.local, modelBaseUrl: $event } } })"
          />
          <el-input
            :model-value="store.config.asr.local.modelRevision"
            placeholder="main / master"
            style="width: 110px"
            @update:model-value="store.patch({ asr: { local: { ...store.config.asr.local, modelRevision: $event } } })"
          />
        </div>
      </SettingRow>
    </template>

    <template v-if="showCloud && current">
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
.ok-hint { color: var(--el-color-success); font-size: 13px; }
</style>
