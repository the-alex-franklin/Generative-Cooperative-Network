import { defineConfig } from 'vite';
import deno from '@deno/vite-plugin';
import react from '@vitejs/plugin-react-swc';
import UnoCSS from 'unocss/vite';

// https://vite.dev/config/
export default defineConfig({
  plugins: [deno(), UnoCSS(), react()],
  server: {
    proxy: {
      '/api': 'http://localhost:8000',
    },
  },
});
