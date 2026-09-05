import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// The live tests only. They talk to the real Supabase project, so they are kept
// out of the default suite and run deliberately with `npm run test:live`.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['**/*.live.test.ts'],
    // One project, one set of rows: parallel files would fight over them.
    fileParallelism: false,
    testTimeout: 60_000,
  },
})
