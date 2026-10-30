<script setup lang="ts">
import { onMounted } from 'vue';
import { useConfigStore } from '@/core/config/ConfigStore';
import SettingRow from '@/components/SettingRow.vue';

const store = useConfigStore();
onMounted(() => store.load());
</script>

<template>
  <div>
    <h2 class="section-title">漫画/图片</h2>

    <h3>漫画翻译</h3>
    <el-alert
      title="译大师使用本地 OCR（tesseract.js，随扩展打包）识别图片/漫画文字，无需会员额度。漫画站点防盗链由 DNR 规则集 rules-image.json 处理（见进阶说明）。"
      type="info" :closable="false" show-icon style="margin-bottom: 8px"
    />
    <SettingRow title="启用漫画翻译入口" desc="在支持的漫画站显示翻译入口；图片右键菜单提供「翻译图片」">
      <el-switch :model-value="store.config.image.mangaEnabled" @update:model-value="store.patch({ image: { mangaEnabled: $event } })" />
    </SettingRow>

    <h3>图片翻译</h3>
    <SettingRow title="图片上显示快捷翻译按钮" desc="鼠标悬停在图片上时触发显示">
      <el-switch :model-value="store.config.image.hoverButtonEnabled" @update:model-value="store.patch({ image: { hoverButtonEnabled: $event } })" />
    </SettingRow>
    <SettingRow title="显示快捷翻译按钮的延迟 (ms)" desc="悬停多久后显示按钮，默认 200">
      <el-input-number
        :model-value="store.config.image.hoverButtonDelayMs"
        :min="100" :max="2000" :step="100"
        @update:model-value="store.patch({ image: { hoverButtonDelayMs: $event } })"
      />
    </SettingRow>
    <SettingRow title="鼠标悬停在图片上触发图片翻译">
      <el-switch :model-value="store.config.image.hoverTranslate" @update:model-value="store.patch({ image: { hoverTranslate: $event } })" />
    </SettingRow>
    <SettingRow title="图片翻译识别引擎" desc="本地 OCR 支持英/德/法/西/葡/意/荷/瑞典/日等 16 语种（原版免费通道同源）">
      <el-select
        :model-value="store.config.image.provider"
        style="width: 220px"
        @update:model-value="store.patch({ image: { provider: $event } })"
      >
        <el-option value="local" label="本地 OCR（免费）" />
        <el-option value="custom" label="自定义（走翻译服务）" />
      </el-select>
    </SettingRow>

    <p class="hint">使用提示：在任意图片上点击右键选择「翻译图片」（需开启右键菜单，见进阶设置）。</p>
  </div>
</template>

<style scoped>
.section-title { margin-top: 0; }
h3 { font-size: 15px; margin: 18px 0 4px; }
.hint { color: var(--el-text-color-secondary); font-size: 13px; margin-top: 18px; }
</style>
