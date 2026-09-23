import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      // He films and posts from a phone on bad signal. Every asset the app
      // needs to boot has to already be on the device before he opens it.
      workbox: {
        // mp3 is here for the till sound on the Post screen. Without it the
        // file is fetched over the network and the one screen he taps on a
        // train is silent - the app has to work with the network off, and
        // that includes the part that tells him he just earned something.
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2,mp3}'],
        navigateFallback: '/index.html',
      },
      devOptions: {
        // So offline behaviour can be tested without a production build.
        enabled: true,
        type: 'module',
      },
      manifest: {
        name: 'UGC production planner',
        short_name: 'UGC',
        // It used to say "Says what to make tonight, and in what order" - the
        // planner he had removed. What is left is a target and a scoreboard.
        description: 'A target and a scoreboard for UGC campaigns: film, post, get paid.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#05070b',
        theme_color: '#05070b',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          {
            src: '/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
          {
            src: '/icon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any',
          },
          {
            src: '/icon-maskable.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'maskable',
          },
        ],
      },
    }),
  ],
})
