import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/** The admin console talks to the API through this proxy in development. */
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    strictPort: true,
    port: 5175,
    proxy: {
      '/v1': 'http://127.0.0.1:3000',
    },
  },
});
