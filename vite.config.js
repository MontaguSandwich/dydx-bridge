import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    host: true
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      output: {
        manualChunks: {
          'cosmos': ['@cosmjs/stargate', '@cosmjs/proto-signing'],
          'vendor': ['react', 'react-dom']
        }
      }
    }
  },
  define: {
    global: 'globalThis'
  },
  resolve: {
    alias: {
      // Polyfills for Node.js modules
      stream: 'stream-browserify',
      buffer: 'buffer'
    }
  }
});
