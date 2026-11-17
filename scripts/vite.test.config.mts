import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
import { defineConfig } from 'vite'

// Bundles scripts/smoke-test.ts for Node so the core services can be tested without Electron.
export default defineConfig({
  resolve: { alias: { '@shared': resolve(__dirname, '../src/shared') } },
  build: {
    ssr: resolve(__dirname, 'smoke-test.ts'),
    outDir: resolve(__dirname, '../out/test'),
    emptyOutDir: true,
    target: 'node22',
    rollupOptions: { external: [/^node:/, 'bcryptjs', 'electron'], output: { format: 'cjs', entryFileNames: 'smoke-test.cjs' } }
  }
})
