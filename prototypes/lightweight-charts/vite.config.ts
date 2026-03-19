import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: './',
  publicDir: false,
  build: {
    outDir: path.resolve(__dirname, '../../site/admin/prototypes/lightweight-charts'),
    emptyOutDir: true,
    target: 'es2022',
  },
})
