import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [vue()],
  // Served under atipik.middlewa.re/admin/ in production.
  base: '/admin/',
  server: {
    port: 5173,
    // Same-origin calls in development too, so the session cookie just works.
    proxy: { '/api': 'http://127.0.0.1:3000' },
  },
})
