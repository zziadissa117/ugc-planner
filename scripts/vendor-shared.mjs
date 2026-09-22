// Copies the client modules the Edge Functions share into
// supabase/functions/_shared.
//
// docs/EDGE_FUNCTION.md requires the functions to run the *same* quote check
// and the *same* hook prompt as the client, and Deno cannot import across the
// src/ boundary, so these files are vendored. They used to be copied by hand,
// and hand copies drift: the server's verify.ts had already lost the
// non-breaking-space character from its normalisation regex, leaving a plain
// space in its place, and nothing noticed. So the copies are generated, and
// `--check` (run by `npm run build`) fails if a checked-in copy no longer
// matches its source.
//
// The only edits made are the ones Deno needs: a header saying where the file
// came from, and relative imports rewritten to the vendored names with their
// `.ts` extension.

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const COPIES = [
  {
    from: 'src/parser/types.ts',
    to: 'supabase/functions/_shared/parserTypes.ts',
    rewrite: (text) =>
      text.replace(
        "import type { ApprovalMode } from '../data'",
        // The one type it borrows from the data layer, restated: the data
        // layer itself is not something a function should carry.
        "export type ApprovalMode = 'none' | 'video' | 'script_and_video' | 'brand_scripted'",
      ),
  },
  {
    from: 'src/parser/verify.ts',
    to: 'supabase/functions/_shared/verify.ts',
    rewrite: (text) => text.replace("from './types'", "from './parserTypes.ts'"),
  },
  {
    from: 'src/hooks/hookPrompt.ts',
    to: 'supabase/functions/_shared/hookPrompt.ts',
    rewrite: (text) => text,
  },
]

function vendored({ from, rewrite }) {
  const source = readFileSync(resolve(ROOT, from), 'utf8')
  const body = rewrite(source)
  if (body === source && from !== 'src/hooks/hookPrompt.ts') {
    throw new Error(`${from}: the import this script rewrites is gone - update vendor-shared.mjs`)
  }
  return `// GENERATED from ${from} by scripts/vendor-shared.mjs - do not edit.\n// Change the source and run \`node scripts/vendor-shared.mjs\`.\n\n${body}`
}

const check = process.argv.includes('--check')
let stale = 0

for (const copy of COPIES) {
  const expected = vendored(copy)
  const path = resolve(ROOT, copy.to)
  let current = ''
  try {
    current = readFileSync(path, 'utf8')
  } catch {
    // Missing counts as stale.
  }
  if (current === expected) continue
  if (check) {
    console.error(`${copy.to} is out of date with ${copy.from}. Run: node scripts/vendor-shared.mjs`)
    stale++
  } else {
    writeFileSync(path, expected)
    console.log(`wrote ${copy.to}`)
  }
}

if (stale > 0) process.exit(1)
