import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [react(), VitePWA({
    registerType: 'prompt',
    injectRegister: 'auto',
    includeAssets: ['icon-180.png'],
    manifest: {
      id: '/', name: 'FamilyCare – CareNest', short_name: 'FamilyCare',
      description: 'Theo dõi sự kiện chăm sóc gia đình', lang: 'vi',
      start_url: '/', scope: '/', display: 'standalone',
      theme_color: '#155869', background_color: '#f2f5f7',
      icons: [
        { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    },
    workbox: {
      globPatterns: ['**/*.{js,css,html,png,svg,webmanifest}'],
      navigateFallback: '/index.html',
      navigateFallbackDenylist: [/^\/events(?:\/|$)/, /^\/status(?:\/|$)/, /^\/ws(?:\/|$)/, /^\/api(?:\/|$)/],
      runtimeCaching: [],
      cleanupOutdatedCaches: true,
    },
  })],
})
