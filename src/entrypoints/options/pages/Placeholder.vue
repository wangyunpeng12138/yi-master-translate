<script setup lang="ts">
import { useRoute } from 'vue-router';

const route = useRoute();
</script>

<template>
  <div>
    <h2 class="section-title">{{ route.meta.title }}</h2>
    <el-alert
      :title="`本分区（#${route.path.slice(1)}）为 P0 占位，将在 ${route.meta.phase} 阶段实现`"
      type="info"
      :closable="false"
      show-icon
    />
  </div>
</template>

<style scoped>
.section-title {
  margin-top: 0;
}
</style>
