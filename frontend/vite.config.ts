import { defineConfig, type Plugin } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

/**
 * Шрифты MathLive: библиотека загружает их из каталога (fontsDirectory),
 * а после сборки относительный путь внутри пакета теряется. Плагин раздаёт
 * их по /mathlive-fonts/ в разработке и кладёт туда же при сборке.
 */
function mathliveFonts(): Plugin {
  // Главный модуль пакета лежит в его корне, рядом с каталогом fonts.
  const dir = join(dirname(createRequire(import.meta.url).resolve('mathlive')), 'fonts');
  return {
    name: 'doska-mathlive-fonts',
    configureServer(server) {
      server.middlewares.use('/mathlive-fonts/', (req, res, next) => {
        const name = (req.url ?? '').replace(/^\//, '').split('?')[0]!;
        if (!/^[\w-]+\.woff2$/.test(name)) return next();
        try {
          res.setHeader('content-type', 'font/woff2');
          res.end(readFileSync(join(dir, name)));
        } catch {
          next();
        }
      });
    },
    generateBundle() {
      for (const name of readdirSync(dir).filter((f) => f.endsWith('.woff2'))) {
        this.emitFile({ type: 'asset', fileName: `mathlive-fonts/${name}`, source: readFileSync(join(dir, name)) });
      }
    },
  };
}

// В разработке Vite проксирует API и WebSocket на бэкенд (localhost:3000),
// поэтому cookie и проверка Origin работают так же, как в production за Nginx.
export default defineConfig({
  plugins: [react(), mathliveFonts()],
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
