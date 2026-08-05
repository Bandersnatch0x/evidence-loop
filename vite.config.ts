import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (/[\\/]node_modules[\\/]playcanvas[\\/]/.test(id)) return 'playcanvas-engine'
          return undefined
        }
      }
    }
  },
  server: {
    host: '0.0.0.0',
    port: 4180
  }
})
