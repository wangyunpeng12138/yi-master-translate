import { defineConfig } from 'wxt';
import AutoImport from 'unplugin-auto-import/vite';
import Components from 'unplugin-vue-components/vite';
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers';

// See https://wxt.dev/api/config.html
export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-vue'],
  vite: () => ({
    plugins: [
      // Element Plus 按需引入（P1 起，替代全量 987KB）
      AutoImport({ resolvers: [ElementPlusResolver()], dts: false }),
      Components({ resolvers: [ElementPlusResolver()], dts: false }),
    ],
  }),
  manifest: {
    name: '沉浸式翻译（复刻版）',
    short_name: '沉浸式翻译',
    description: '双语对照网页翻译 · 本地复刻版（Chrome MV3）',
    permissions: [
      'storage',
      'activeTab',
      'contextMenus',
      'sidePanel',
      'offscreen',
      'declarativeNetRequest',
      'declarativeNetRequestWithHostAccess',
    ],
    host_permissions: ['<all_urls>'],
    options_ui: {
      open_in_tab: true,
    },
    commands: {
      toggleTranslatePage: {
        description: '翻译网页/显示原文',
        suggested_key: { default: 'Alt+A' },
      },
      toggleTranslateTheWholePage: {
        description: '翻译页面全部区域/显示原文',
        suggested_key: { default: 'Alt+W' },
      },
      toggleTranslateTheMainPage: {
        description: '翻译页面主要区域/显示原文',
      },
      toggleSidePanel: {
        description: '开启/关闭侧边栏',
        suggested_key: { default: 'Alt+S' },
      },
      translateInputBox: {
        description: '翻译当前输入框内容',
        suggested_key: { default: 'Alt+I' },
      },
      toggleOnlyTransation: { description: '切换双语/仅译文模式' },
      toggleTranslateToThePageEndImmediately: {
        description: '立即翻译到页面底部/显示原文',
      },
      toggleTranslationMask: { description: '切换当前页面译文为模糊效果（学习模式）' },
      openAiWritingModal: { description: '打开 AI Write 弹窗' },
      toggleMouseHoverTranslateDirectly: {
        description: '在页面上临时启用或关闭鼠标悬停直接翻译',
      },
      toggleVideoSubtitlePreTranslation: {
        description: '切换双语字幕优先使用本扩展设置',
      },
      translateWithBing: { description: '临时使用微软翻译当前页面' },
      translateWithGoogle: { description: '临时使用谷歌翻译当前页面' },
      translateWithDeepL: { description: '临时使用 DeepL 翻译当前页面' },
      translateWithOpenAI: { description: '临时使用 OpenAI 翻译当前页面' },
      translateWithGemini: { description: '临时使用 Gemini 翻译当前页面' },
      translateWithClaude: { description: '临时使用 Claude 翻译当前页面' },
      translateWithTransmart: { description: '临时使用腾讯翻译当前页面' },
      translateWithCustom1: { description: '临时使用自定义翻译服务翻译当前页面(1)' },
      translateWithCustom2: { description: '临时使用自定义翻译服务翻译当前页面(2)' },
      translateWithCustom3: { description: '临时使用自定义翻译服务翻译当前页面(3)' },
    },
    web_accessible_resources: [
      {
        matches: ['<all_urls>'],
        resources: ['content-scripts/*'],
      },
    ],
  },
});
