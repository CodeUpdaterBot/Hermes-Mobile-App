import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const host = process.env.TAURI_DEV_HOST

export default defineConfig({
  plugins: [react()],
  server: {
    host: host || '127.0.0.1',
    port: 1420,
    strictPort: true,
    hmr: host ? { protocol: 'ws', host, port: 1421 } : undefined,
    // The Rust side rebuilds constantly inside src-tauri/target. Watching those
    // artifacts makes the frontend watcher crash with EBUSY on Windows while
    // Cargo is mid-write, so the native build directory is excluded.
    watch: { ignored: ['**/src-tauri/**', '**/.git/**'] },
  },
})
