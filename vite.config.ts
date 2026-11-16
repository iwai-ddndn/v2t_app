import path from 'node:path';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// 公開時は 1 枚の HTML にまとめ、scripts/build.mjs で丸ごと暗号化する
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss(), viteSingleFile()],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, './src') } },
  build: { outDir: 'build', emptyOutDir: true, target: 'safari16' },
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
});
