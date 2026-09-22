// The vendored Edge Function copies are generated from src/, never kept by
// hand. This runs the generator's own check as part of `npm test`, so drift
// fails the ordinary suite as well as the build.

import { execFileSync } from 'node:child_process'

import { expect, it } from 'vitest'

it('every copy under supabase/functions/_shared matches its source', () => {
  expect(() =>
    execFileSync('node', ['scripts/vendor-shared.mjs', '--check'], { stdio: 'pipe' }),
  ).not.toThrow()
})
