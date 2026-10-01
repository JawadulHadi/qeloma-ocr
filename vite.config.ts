/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { apiDevPlugin } from './server/dev-plugin.ts'

// https://vite.dev/config/
export default defineConfig({
  // apiDevPlugin serves the Vercel functions in /api during `npm run dev`,
  // so the whole app (auth + AI) runs locally without the Vercel CLI.
  plugins: [react(), apiDevPlugin()],
  server: {
    host: '0.0.0.0',
    port: 3000,
    allowedHosts: true,
  },
  build: {
    // The largest chunk is the HEIC decoder (~1.3 MB), which loads only when someone opens a HEIC photo.
    chunkSizeWarningLimit: 1400,
    rolldownOptions: {
      // auth/microsoft.html receives the OneDrive sign-in pop-up's result.
      input: { main: 'index.html', microsoft: 'auth/microsoft.html' },
    },
  },
  optimizeDeps: {
    // pdf.js ships its own worker; tesseract.js loads its worker/core from a CDN at runtime.
    exclude: ['pdfjs-dist'],
  },
  test: {
    include: ['src/**/*.test.{ts,tsx}', 'server/**/*.test.ts', 'api/**/*.test.ts', 'shared/**/*.test.ts'],
    environment: 'node',
  },
})
