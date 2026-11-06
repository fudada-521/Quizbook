import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig({
  plugins: [
    react(),
    // 将所有 JS/CSS 内联进单个 index.html，恢复「双击即可离线打开」的核心体验
    viteSingleFile(),
    VitePWA({
      // 单文件模式下 Service Worker 仍可用于「安装到主屏」；离线缓存整页
      registerType: 'autoUpdate',
      injectRegister: 'script',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: '天权 Megrez',
        short_name: '天权',
        description: '刷题·即时判分·错题本（2726 题）',
        lang: 'zh-CN',
        theme_color: '#f6f6f3',
        background_color: '#f6f6f3',
        display: 'standalone',
        start_url: '.',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // 单文件下直接缓存 index.html 本身
        globPatterns: ['**/*.{html,css,js,svg,png}'],
        navigateFallback: 'index.html',
        // 题库扩大后单文件超过 Workbox 默认 2 MiB 预缓存上限
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
    }),
  ],
  resolve: {
    dedupe: ['react', 'react-dom'],
  },
  build: {
    target: 'es2020',
    sourcemap: false,
    chunkSizeWarningLimit: 4000,
    // 单文件内联需要 inlineDynamicImports
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
});