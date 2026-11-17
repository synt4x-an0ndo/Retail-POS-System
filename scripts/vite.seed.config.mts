import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'
import { defineConfig } from 'vite'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Bundles scripts/seed-demo.ts for Node.
export default defineConfig({
  resolve: { alias: { '@shared': resolve(__dirname, '../src/shared') } },
  build: {
    ssr: resolve(__dirname, 'seed-demo.ts'),
    outDir: resolve(__dirname, '../out/seed'),
    emptyOutDir: true,
    target: 'node22',
    rollupOptions: { external: [/^node:/, 'bcryptjs', 'electron'], output: { format: 'cjs', entryFileNames: 'seed-demo.cjs' } }
  }
})
