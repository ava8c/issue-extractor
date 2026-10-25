import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => ({
  define: {
    'import.meta.env.ISSUE_ATLAS_HANDOFF_ENABLED': JSON.stringify(
      (loadEnv(mode, process.cwd(), '').ISSUE_ATLAS_HANDOFF_ENABLED ?? 'false')
        .trim()
        .toLowerCase(),
    ),
  },
  plugins: [react()],
  base: './',
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  build: {
    outDir: 'dist',
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom'],
          markdown: ['react-markdown', 'remark-gfm', 'rehype-raw', 'rehype-sanitize'],
        },
      },
    },
  },
}))
