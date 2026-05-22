import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// v1.6.3：所有后端调用都走相对路径（/api/*、/health、/uploads/*）
// dev 时 Vite proxy 转发到 :3001；生产构建用 nginx 反代
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/health': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/uploads': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    }
  }
})
