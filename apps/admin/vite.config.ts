import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 后台挂在同域 /admin/ 下，由 server 的 @fastify/static 托管
export default defineConfig({
  base: '/admin/',
  plugins: [react()],
  server: {
    port: 5174,
    proxy: {
      '/api': {
        target: process.env.ADMIN_API_TARGET ?? 'http://127.0.0.1:8787',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});