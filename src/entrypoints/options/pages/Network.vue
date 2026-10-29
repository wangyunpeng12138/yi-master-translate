<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { useConfigStore } from '@/core/config/ConfigStore';
import SettingRow from '@/components/SettingRow.vue';

const store = useConfigStore();
onMounted(() => store.load());

const domainsText = computed({
  get: () => store.config.network.proxyDomains.join('\n'),
  set: (v: string) =>
    store.patch({
      network: {
        proxyDomains: (v as string)
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean),
      },
    }),
});
</script>

<template>
  <div>
    <h2 class="section-title">网络代理</h2>

    <el-alert
      type="warning"
      :closable="false"
      show-icon
      title="开启后将接管浏览器代理：仅命中下方域名清单的请求走本地代理，其余全部直连（不再经过系统代理）"
      style="margin-bottom: 16px"
    />
    <el-alert
      type="info"
      :closable="false"
      show-icon
      title="上游出口由你的代理软件（Clash/V2Ray 等）的分流规则决定：若翻译域名在代理软件里被分流到「直连」，依旧无法访问，请将 translate.googleapis.com 等域名指向代理节点"
      style="margin-bottom: 16px"
    />

    <SettingRow title="启用网络代理" desc="翻译接口请求经本地代理转发（应对直连不可达环境）">
      <el-switch
        :model-value="store.config.network.proxyEnabled"
        @update:model-value="store.patch({ network: { proxyEnabled: $event } })"
      />
    </SettingRow>

    <SettingRow title="代理地址" desc="本地代理监听地址（如 Clash 默认 127.0.0.1:7890）">
      <el-input
        :model-value="store.config.network.proxyHost"
        style="width: 160px"
        placeholder="127.0.0.1"
        @update:model-value="store.patch({ network: { proxyHost: $event } })"
      />
    </SettingRow>

    <SettingRow title="代理端口" desc="HTTP 或 SOCKS 混合端口">
      <el-input-number
        :model-value="store.config.network.proxyPort"
        :min="1" :max="65535"
        @update:model-value="store.patch({ network: { proxyPort: $event } })"
      />
    </SettingRow>

    <SettingRow title="代理协议" desc="混合端口（Clash 7890 等）选 HTTP 即可">
      <el-select
        :model-value="store.config.network.proxyType"
        style="width: 160px"
        @update:model-value="store.patch({ network: { proxyType: $event } })"
      >
        <el-option value="http" label="HTTP" />
        <el-option value="socks5" label="SOCKS5" />
      </el-select>
    </SettingRow>

    <SettingRow
      title="走代理的域名清单"
      desc="每行一个域名；内置免费通道与自定义 AI 服务域名会自动并入，无需手动添加。支持 shExpMatch 通配（如 *.openai.com 匹配子域）"
    >
      <el-input
        v-model="domainsText"
        type="textarea" :rows="5" style="width: 360px"
      />
    </SettingRow>
  </div>
</template>

<style scoped>
.section-title { margin-top: 0; }
</style>
