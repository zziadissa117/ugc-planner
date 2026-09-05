import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// Separate from vite.config.ts so the PWA plugin does not run for tests -
// there is no service worker to generate here.
export default defineConfig({
  plugins: [react()],
  test: {
    // jsdom for the component tests. The data-layer tests run fine under it
    // too, since fake-indexeddb supplies its own IndexedDB either way.
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    // *.live.test.ts talk to the real Supabase project. They are excluded
    // here so the default suite stays offline, fast and deterministic - run
    // them deliberately with `npm run test:live`.
    exclude: ['**/node_modules/**', '**/dist/**', '**/*.live.test.ts'],
  },
})
