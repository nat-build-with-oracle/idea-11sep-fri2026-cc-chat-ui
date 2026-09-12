import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { createBuildInfo } from './scripts/build-info.ts'

export default defineConfig(({ mode }) => {
  const buildInfo = createBuildInfo({ mode: mode === 'production' ? 'production' : 'development' })

  return {
    define: { __BUILD_INFO__: JSON.stringify(buildInfo) },
    plugins: [
      react(),
      tailwindcss(),
      {
        name: 'build-info-asset',
        apply: 'build',
        generateBundle() {
          this.emitFile({ type: 'asset', fileName: 'version.json', source: `${JSON.stringify(buildInfo, null, 2)}\n` })
        },
      },
    ],
    server: {
      host: '127.0.0.1',
      port: 5173,
      strictPort: true,
      proxy: { '/api': { target: 'http://127.0.0.1:4318', changeOrigin: true } },
    },
  }
})
