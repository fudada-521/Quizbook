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
        name: '高项千题闯关',
        short_name: '千题闯关',
        description: '软考高项综合知识刷题（2210 题）',
        lang: 'zh-CN',
        theme_color: '#3b6ef5',
        background_color: '#f4f6fa',
        display: 'standalone',
        start_url: '.',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // 单文件下直接缓存 index.html 本身
        globPatterns: ['**/*.{html,css,js,svg,png}'],
        navigateFallback: 'index.html',
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