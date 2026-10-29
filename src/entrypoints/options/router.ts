import { createRouter, createWebHashHistory } from 'vue-router';
import Placeholder from './pages/Placeholder.vue';
import Preview from './pages/Preview.vue';
import General from './pages/General.vue';
import Services from './pages/Services.vue';
import Input from './pages/Input.vue';
import Floating from './pages/Floating.vue';
import Shortcuts from './pages/Shortcuts.vue';
import Advanced from './pages/Advanced.vue';
import ImportExport from './pages/ImportExport.vue';
import About from './pages/About.vue';

/** 分区 → 页面组件映射（P5 八区已实现，P6 剩余区待替换） */
const PAGE_MAP: Record<string, unknown> = {
  general: General,
  services: Services,
  input: Input,
  floating: Floating,
  shortcuts: Shortcuts,
  advanced: Advanced,
  import_export: ImportExport,
  about: About,
};

/**
 * 设置页 hash 路由（对齐原版 options.html#<section> 直链习惯）
 * 16 分区：P5/P6 逐个以真实页面组件替换 Placeholder。
 */
export const SECTIONS: Array<{ path: string; title: string; phase: string }> = [
  { path: 'general', title: '基本设置', phase: 'P5' },
  { path: 'services', title: '翻译服务', phase: 'P5' },
  { path: 'ai', title: 'AI 专家', phase: 'P6' },
  { path: 'terms', title: 'AI 术语库', phase: 'P6' },
  { path: 'writing', title: 'AI Write', phase: 'P7' },
  { path: 'subtitle', title: '视频字幕', phase: 'P6' },
  { path: 'manga', title: '漫画/图片', phase: 'P6' },
  { path: 'input', title: '输入框翻译', phase: 'P5' },
  { path: 'selection_translation', title: '划词翻译', phase: 'P6' },
  { path: 'mouse_hover', title: '鼠标悬停', phase: 'P6' },
  { path: 'floating', title: '悬浮球', phase: 'P5' },
  { path: 'shortcuts', title: '快捷键', phase: 'P5' },
  { path: 'advanced', title: '进阶设置', phase: 'P5' },
  { path: 'import_export', title: '导入/导出', phase: 'P5' },
  { path: 'about', title: '关于', phase: 'P5' },
  { path: 'developer', title: '开发者设置', phase: 'P6' },
];

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    // P1/P2 验收页（隐藏入口，直接访问 #preview）
    { path: '/preview', component: Preview, meta: { title: '组件预览' } },
    ...SECTIONS.map((s) => ({
      path: `/${s.path}`,
      component: (PAGE_MAP[s.path] as never) ?? Placeholder,
      meta: { title: s.title, phase: s.phase },
    })),
    { path: '/:pathMatch(.*)*', redirect: '/general' },
  ],
});
