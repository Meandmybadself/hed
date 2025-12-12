import { defineConfig } from 'vite';

export default defineConfig({
  // For GitHub Pages project sites, set BASE_PATH="/<repo>/" in CI.
  base: process.env.BASE_PATH ?? '/',
  server: {
    port: 5173,
  },
});


