import path from "path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { inspectAttr } from 'kimi-plugin-inspect-react'
import { devSyncPlugin } from './scripts/vite-plugin-dev-sync'

// https://vite.dev/config/
export default defineConfig({
  base: '/',
  // devSyncPlugin: dev 文案管理 → POST /__sync/captions 直写 quickModeTexts.ts (apply: 'serve' 仅 dev)
  plugins: [inspectAttr(), react(), devSyncPlugin()],
  server: {
    port: 3000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
