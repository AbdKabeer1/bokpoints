import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * The owner portal talks to the API through this proxy in development, so the
 * browser sees one origin and no CORS setup is needed locally. A deployed
 * build sets VITE_API_BASE to the API's origin instead.
 */
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    proxy: {
      '/v1': 'http://127.0.0.1:3000',
    },
  },
});
