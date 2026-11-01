import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// В разработке Vite проксирует API и WebSocket на бэкенд (localhost:3000),
// поэтому cookie и проверка Origin работают так же, как в production за Nginx.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: false },
      '/ws': { target: 'ws://localhost:3000', ws: true },
    },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 1500,
  },
  test: {
    environment: 'jsdom',
    // В тестах берём браузерную сборку Konva (поле browser), а не
    // node-сборку, которой нужен нативный пакет canvas.
    alias: [{ find: /^konva$/, replacement: 'konva/lib/index.js' }],
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
