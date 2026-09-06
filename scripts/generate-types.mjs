// Generates src/data/schema.ts from docs/schema.sql.
//
// docs/schema.sql is the authoritative shape. Hand-transcribing it into
// TypeScript would let the two drift apart silently, and the local store is
// required to mirror Postgres exactly - same table names, same column names,
// same enums. So the types are generated, and `npm run check:types` fails the
// build if the checked-in output no longer matches the SQL.
//
// This parser only understands the subset of DDL that schema.sql actually uses.
// It throws on anything it does not recognise rather than guessing, because a
// silently skipped column is exactly the kind of drift this script exists to
// prevent.

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SQL_PATH = resolve(ROOT, 'docs/schema.sql')
const OUT_PATH = resolve(ROOT, 'src/data/schema.ts')

/** Postgres type -> TypeScript type. Money is always integer cents, so every
 *  *_cents column lands on `number` via `integer` and never via a float type.
 *  numeric(3,2) is the bonus probability: 0..1, two decimal places. */
const TYPE_MAP = {
  uuid: 'string',
  text: 'string',
  boolean: 'boolean',
  integer: 'number',
  bigserial: 'number',
  timestamptz: 'string', // ISO 8601
  date: 'string', // YYYY-MM-DD
  numeric: 'number',
}

/** Strip `--` line comments without touching `--` inside string literals. */
function stripComments(sql) {
  return sql
    .split('\n')
    .map((line) => {
      let inString = false
      for (let i = 0; i < line.length; i++) {
        const ch = line[i]
        if (ch === "'") inString = !inString
        else if (!inString && ch === '-' && line[i + 1] === '-') {
          return line.slice(0, i)
        }
      }
      return line
    })
    .join('\n')
}

/** Read a parenthesised group starting at `open`, returning its inner text and
 *  the index just past the closing paren. Respects nesting and strings. */
function readGroup(sql, open) {
  let depth = 0
  let inString = false
  for (let i = open; i < sql.length; i++) {
    const ch = sql[i]
    if (ch === "'") inString = !inString
    else if (!inString && ch === '(') depth++
    else if (!inString && ch === ')') {
      depth--
      if (depth === 0) return { body: sql.slice(open + 1, i), end: i + 1 }
    }
  }
  throw new Error(`Unbalanced parentheses starting at offset ${open}`)
}

/** Split on commas that are not inside parentheses or strings. */
function splitTopLevel(body) {
  const parts = []
  let depth = 0
  let inString = false
  let current = ''
  for (const ch of body) {
    if (ch === "'") inString = !inString
    if (!inString && ch === '(') depth++
    if (!inString && ch === ')') depth--
    if (ch === ',' && depth === 0 && !inString) {
      parts.push(current)
      current = ''
    } else {
      current += ch
    }
  }
  parts.push(current)
  return parts.map((p) => p.trim()).filter(Boolean)
}

function parseEnums(sql) {
  const enums = new Map()
  const re = /create\s+type\s+(\w+)\s+as\s+enum\s*\(/gi
  let match
  while ((match = re.exec(sql)) !== null) {
    const { body } = readGroup(sql, re.lastIndex - 1)
    const values = [...body.matchAll(/'([^']*)'/g)].map((m) => m[1])
    if (values.length === 0) throw new Error(`Enum ${match[1]} has no values`)
    enums.set(match[1], values)
  }
  return enums
}

const CONSTRAINT_START = /^(constraint|check|unique|primary\s+key|foreign\s+key)\b/i

function parseTables(sql, enums) {
  const tables = []
  const re = /create\s+table\s+(\w+)\s*\(/gi
  let match
  while ((match = re.exec(sql)) !== null) {
    const name = match[1]
    const { body, end } = readGroup(sql, re.lastIndex - 1)
    re.lastIndex = end

    const columns = []
    const tableChecks = []

    for (const part of splitTopLevel(body)) {
      if (CONSTRAINT_START.test(part)) {
        tableChecks.push(part.replace(/\s+/g, ' '))
        continue
      }
      columns.push(parseColumn(part, name, enums))
    }

    if (columns.length === 0) throw new Error(`Table ${name} parsed no columns`)
    tables.push({ name, columns, tableChecks })
  }
  return tables
}

function parseColumn(part, tableName, enums) {
  const normalised = part.replace(/\s+/g, ' ').trim()
  const m = /^(\w+)\s+([\w]+)(\([^)]*\))?\s*(.*)$/.exec(normalised)
  if (!m) throw new Error(`Cannot parse column in ${tableName}: ${normalised}`)

  const [, name, rawType, , rest] = m
  const pgType = rawType.toLowerCase()

  let tsType
  if (enums.has(pgType)) tsType = pgType
  else if (pgType in TYPE_MAP) tsType = TYPE_MAP[pgType]
  else throw new Error(`Unmapped type "${pgType}" on ${tableName}.${name}`)

  const notNull = /\bnot null\b/i.test(rest)
  const isPrimaryKey = /\bprimary key\b/i.test(rest)
  // bigserial and `default ...` both mean the database supplies a value, so the
  // column is optional at insert time.
  const hasDefault = /\bdefault\b/i.test(rest) || pgType === 'bigserial'

  // Column-level CHECKs carry the non-negative guards on money and counts.
  // IndexedDB enforces none of them, so they have to be recorded and then
  // re-implemented in code.
  const checks = []
  const checkRe = /\bcheck\s*\(/gi
  while (checkRe.exec(rest) !== null) {
    const { body, end } = readGroup(rest, checkRe.lastIndex - 1)
    checks.push(`check (${body.trim()})`)
    checkRe.lastIndex = end
  }

  return {
    name,
    pgType,
    tsType,
    // Primary keys are never null even without an explicit NOT NULL.
    nullable: !(notNull || isPrimaryKey),
    optionalOnInsert: hasDefault,
    checks,
  }
}

function toPascal(snake) {
  return snake
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join('')
}

/** Singularise a table name for its row type: campaigns -> Campaign,
 *  campaign_fields -> CampaignField, user_settings -> UserSettings. */
const ROW_TYPE_NAMES = {
  campaigns: 'Campaign',
  campaign_documents: 'CampaignDocument',
  campaign_fields: 'CampaignField',
  campaign_angles: 'CampaignAngle',
  campaign_rules: 'CampaignRule',
  videos: 'Video',
  video_posts: 'VideoPost',
  phase_events: 'PhaseEvent',
  warmup_events: 'WarmupEvent',
  bonus_tiers: 'BonusTier',
  bonus_claims: 'BonusClaim',
  time_estimates: 'TimeEstimate',
  user_settings: 'UserSettings',
}

function rowTypeName(table) {
  const known = ROW_TYPE_NAMES[table]
  if (!known) {
    throw new Error(
      `No row type name registered for table "${table}". Add it to ROW_TYPE_NAMES in scripts/generate-types.mjs.`,
    )
  }
  return known
}

function generate(enums, tables) {
  const out = []

  out.push('// GENERATED FILE - DO NOT EDIT BY HAND.')
  out.push('//')
  out.push('// Produced from docs/schema.sql by scripts/generate-types.mjs.')
  out.push('// Change the SQL, then run `npm run generate:types`.')
  out.push('//')
  out.push('// docs/schema.sql is the authoritative shape: the local store mirrors')
  out.push('// Postgres table for table and column for column, so that the eventual')
  out.push('// SupabaseAdapter needs no translation layer.')
  out.push('')

  out.push('// --- Enums ---------------------------------------------------------------')
  out.push('')
  for (const [name, values] of enums) {
    const type = toPascal(name)
    out.push(`export type ${type} =`)
    out.push(values.map((v) => `  | '${v}'`).join('\n'))
    out.push('')
    out.push(`export const ${name.toUpperCase()}_VALUES = [`)
    out.push(values.map((v) => `  '${v}',`).join('\n'))
    out.push(`] as const satisfies readonly ${type}[]`)
    out.push('')
  }

  out.push('// --- Row types -----------------------------------------------------------')
  out.push('')
  for (const table of tables) {
    const type = rowTypeName(table.name)
    out.push(`/** Mirrors \`${table.name}\`. */`)
    out.push(`export interface ${type} {`)
    for (const col of table.columns) {
      const ts = enums.has(col.pgType) ? toPascal(col.pgType) : col.tsType
      out.push(`  ${col.name}: ${ts}${col.nullable ? ' | null' : ''}`)
    }
    out.push('}')
    out.push('')

    // What a caller must supply. Columns the database would default are
    // optional; everything else is required.
    //
    // user_id is dropped entirely rather than made optional: it is whoever is
    // signed in. Postgres takes it from auth.uid() and the adapter supplies it
    // locally, so a caller has no business passing one and no way to pass a
    // different one.
    const optional = table.columns.filter((c) => c.optionalOnInsert).map((c) => c.name)
    const adapterOwned = table.columns.some((c) => c.name === 'user_id') ? ['user_id'] : []
    const omitted = [...adapterOwned, ...optional]

    if (omitted.length > 0) {
      out.push(
        `/** \`${table.name}\` as supplied by a caller: user_id comes from the session, and`,
      )
      out.push(` *  columns the database defaults are optional. */`)
      const quoted = (names) => names.map((n) => `'${n}'`).join(' | ')
      if (optional.length > 0) {
        out.push(`export type New${type} = Omit<${type}, ${quoted(omitted)}> &`)
        out.push(`  Partial<Pick<${type}, ${quoted(optional)}>>`)
      } else {
        out.push(`export type New${type} = Omit<${type}, ${quoted(omitted)}>`)
      }
      out.push('')
    } else {
      out.push(`export type New${type} = ${type}`)
      out.push('')
    }
  }

  out.push('// --- Table registry ------------------------------------------------------')
  out.push('')
  out.push('/** Every table, in dependency order: parents before children, so an import')
  out.push(' *  can replay them top to bottom without dangling references. */')
  out.push('export const TABLE_NAMES = [')
  for (const table of tables) out.push(`  '${table.name}',`)
  out.push('] as const')
  out.push('')
  out.push('export type TableName = (typeof TABLE_NAMES)[number]')
  out.push('')
  out.push('/** Maps each table name to its row type. */')
  out.push('export interface TableRowMap {')
  for (const table of tables) out.push(`  ${table.name}: ${rowTypeName(table.name)}`)
  out.push('}')
  out.push('')

  out.push('// --- Constraints carried over from the SQL --------------------------------')
  out.push('')
  out.push('/** The table-level constraints IndexedDB cannot enforce, kept here verbatim')
  out.push(' *  so that src/data/constraints.ts can be checked against them by eye.')
  out.push(' *  The enforcing code lives there; this is the record of what it owes. */')
  out.push('export const SQL_TABLE_CONSTRAINTS: Readonly<Record<string, readonly string[]>> = {')
  for (const table of tables) {
    if (table.tableChecks.length === 0) continue
    out.push(`  ${table.name}: [`)
    for (const c of table.tableChecks) out.push(`    ${JSON.stringify(c)},`)
    out.push('  ],')
  }
  out.push('}')
  out.push('')

  out.push('/** Column-level CHECKs, per table, per column. Mostly the non-negative')
  out.push(' *  guards on money and counts - IndexedDB enforces none of them. */')
  out.push(
    'export const SQL_COLUMN_CHECKS: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>> = {',
  )
  for (const table of tables) {
    const checked = table.columns.filter((c) => c.checks.length > 0)
    if (checked.length === 0) continue
    out.push(`  ${table.name}: {`)
    for (const col of checked) {
      out.push(`    ${col.name}: [${col.checks.map((c) => JSON.stringify(c)).join(', ')}],`)
    }
    out.push('  },')
  }
  out.push('}')
  out.push('')

  return out.join('\n')
}

const sql = stripComments(readFileSync(SQL_PATH, 'utf8'))
const enums = parseEnums(sql)
const tables = parseTables(sql, enums)
const output = generate(enums, tables)

const check = process.argv.includes('--check')
if (check) {
  let existing = null
  try {
    existing = readFileSync(OUT_PATH, 'utf8')
  } catch {
    /* not generated yet */
  }
  if (existing !== output) {
    console.error(
      'src/data/schema.ts is out of date with docs/schema.sql.\nRun: npm run generate:types',
    )
    process.exit(1)
  }
  console.log(`schema.ts matches docs/schema.sql (${tables.length} tables, ${enums.size} enums)`)
} else {
  writeFileSync(OUT_PATH, output, 'utf8')
  console.log(
    `Wrote src/data/schema.ts - ${tables.length} tables, ${enums.size} enums, from docs/schema.sql`,
  )
}
