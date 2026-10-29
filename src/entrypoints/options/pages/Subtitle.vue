<script setup lang="ts">
import { onMounted } from 'vue';
import { useConfigStore } from '@/core/config/ConfigStore';
import SettingRow from '@/components/SettingRow.vue';
import ServicePicker from '@/components/ServicePicker.vue';

const store = useConfigStore();
onMounted(() => store.load());
</script>

<template>
  <div>
    <h2 class="section-title">视频字幕</h2>
    <el-alert
      title="在支持的视频网站播放时显示双语字幕。实现方式：拦截页面已有的 <track> 字幕轨并翻译（无字幕视频的云端 ASR 识别已裁剪）。除 YouTube 外需手动开启平台自身字幕。"
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
  </div>
</template>

<style scoped>
.section-title { margin-top: 0; }
h3 { font-size: 15px; margin: 18px 0 4px; }
</style>
