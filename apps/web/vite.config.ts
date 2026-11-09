import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const backend = process.env.DAGGERY_DEV_BACKEND ?? 'http://127.0.0.1:3000';
const workspaceSources = ['../../packages/shared/src/', '../../packages/content/']
  .map(path => fileURLToPath(new URL(path, import.meta.url)));

export default defineConfig({
  plugins: [react(), tailwindcss(), {
    name: 'daggery-workspace-sources',
    configureServer(server) {
      // These workspaces live outside Vite's web root. Watch their sources explicitly
      // so new exports do not leave the browser using an old transformed barrel.
      server.watcher.add(workspaceSources);
    },
  }],
  server: {
    port: Number(process.env.DAGGERY_DEV_PORT ?? 5173),
    proxy: {
      // Use loopback explicitly to avoid IPv6 resolution surprises on Windows.
      '/api': backend,
      '/cards': backend,
      '/ws': {
        target: backend.replace(/^http/, 'ws'),
        ws: true,
      },
    },
  },
});
