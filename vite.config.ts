import path from "path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { inspectAttr } from 'kimi-plugin-inspect-react'
import { devSyncPlugin } from './scripts/vite-plugin-dev-sync'
import { searchProxyDevPlugin } from './scripts/vite-plugin-search-proxy'
import { networkPoolSyncPlugin } from './scripts/vite-plugin-network-pool-sync'
import { ttsProxyDevPlugin } from './scripts/vite-plugin-tts-proxy'

// https://vite.dev/config/
export default defineConfig({
  base: '/',
  // devSyncPlugin: dev 文案管理 → POST /__sync/captions 直写 quickModeTexts.ts (apply: 'serve' 仅 dev)
  // searchProxyDevPlugin: dev 模拟 /api/search-pandas + /api/proxy-image (apply: 'serve' 仅 dev)
  // networkPoolSyncPlugin: dev ⭐ 沉淀 → POST /__sync/network-pool 写盘到 src/data/network-pool.ts (apply: 'serve' 仅 dev)
  // ttsProxyDevPlugin: dev /api/tts → 中转有道 (跟 prod Netlify Function 同 path, 一份代码)
  plugins: [
    inspectAttr(),
    react(),
    devSyncPlugin(),
    searchProxyDevPlugin(),
    networkPoolSyncPlugin(),
    ttsProxyDevPlugin(),
  ],
  server: {
    port: 3000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
