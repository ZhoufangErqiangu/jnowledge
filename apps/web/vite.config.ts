import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// 后端代理目标：把 API 前缀转发到 Koa（默认 3000）。
const API_PREFIXES = [
  '/health',
  '/auth',
  '/collections',
  '/documents',
  '/conversations',
  '/openapi.json',
  '/docs',
]

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    port: 5173,
    proxy: Object.fromEntries(
      API_PREFIXES.map((p) => [p, { target: 'http://localhost:3000', changeOrigin: true }]),
    ),
  },
})
