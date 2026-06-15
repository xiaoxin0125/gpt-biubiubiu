import { rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const cleanGeneratedDist = () => ({
  name: 'clean-generated-dist',
  buildStart() {
    const distRoot = resolve(process.cwd(), 'dist');
    ['assets', 'index.html', 'favicon.ico', 'api/.php-api-config.php'].forEach((entry) => {
      rmSync(resolve(distRoot, entry), { recursive: true, force: true });
    });
  },
});

export default defineConfig({
  plugins: [cleanGeneratedDist(), react()],
  build: {
    emptyOutDir: false,
  },
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:8088',
    },
  },
});