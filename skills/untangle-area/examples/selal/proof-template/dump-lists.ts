/*
 * Part 1 of the untangle differential: dump every money-kind list as sorted JSON.
 *
 * Run from a tree root (the tree whose tsconfig resolves '@/...'):
 *   npx tsx dump-lists.ts [--root <tree>] [--area <dir>] [--season <dir>] > lists-before.json
 * Every path below is relative to --root; rewire the '@/' imports at the top
 * to the area you are proving.
 *
 * Adapter notes (printed in the report):
 *  - In BEFORE, `PAYMENT_FAMILY_GROUPS`, `DEPOSIT_FAMILY_SET`,
 *    `DIRECT_DEPOSIT_CHARGE_FAMILIES`, `DIRECT_DEPOSIT_REFUND_FAMILIES` and
 *    `DISCOUNT_ORIGINAL_REFERENCE_TYPE_MAP` are module-private. They are read
 *    from the source literal (the same technique the brief sanctions for the
 *    discount map). In AFTER they are exported (catalog-derived), so they are
 *    imported.
 *  - `liveSeasonIdSql` exists only in AFTER (#3983). BEFORE has the same SQL
 *    inline; that fragment is read from source as text.
 */

import fs from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'

import { LedgerReferenceType } from '@/generated/prisma/enums'
import { LEDGER_ENTRY_SUBTYPES } from '@/lib/ledger-entry-catalog'
import { resolveSettlementScopeReferenceTypes } from '@/server/services/billing/charge-settlement'
import { MANUAL_ROW_REVERSE_ACTION } from '@/server/services/billing/manual-row-actions'
import { OUTSTANDING_CHARGE_REFERENCE_TYPES } from '@/server/services/billing/outstanding-debt'
import { KNOWN_REFERENCE_TYPE_FAMILIES } from '@/server/services/billing/wallet-audit/types'
import { WALLET_COLUMN_BY_REFERENCE_TYPE } from '@/server/services/billing/wallet-column-map'
import { NO_RING, NOT_ON_TRADER_WALLET, RING_SOURCE } from '@/server/services/billing/wallet-row-ring'
import {
  DEPOSIT_PAID_REFERENCE_TYPES,
  DEPOSIT_RETURNED_REFERENCE_TYPES,
} from '@/server/services/billing/wallet-ledger-totals'
import { OPERATIONAL_SEASON_ID } from '@/server/services/season/season-deployment-state.service'

const { values } = parseArgs({
  options: {
    root: { type: 'string' },
    area: { type: 'string' },
    season: { type: 'string' },
  },
})
const ROOT = path.resolve(values.root ?? process.cwd())
const AREA = path.join(ROOT, values.area ?? 'src/server/services/billing')
const SEASON = path.join(ROOT, values.season ?? 'src/server/services/season')

const hasCatalog = fs.existsSync(path.join(AREA, 'wallet-reference-type-catalog.ts'))

/** Slice `text` from the bracket at `start` to its matching close bracket. */
function balanced(text: string, start: number): string {
  const open = text[start]
  const close = open === '[' ? ']' : open === '{' ? '}' : open === '(' ? ')' : null
  if (!close) throw new Error(`not a bracket at ${start}: ${open}`)
  let depth = 0
  for (let i = start; i < text.length; i++) {
    if (text[i] === open) depth++
    else if (text[i] === close) {
      depth--
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  throw new Error('unbalanced')
}

/** The literal assigned to `const NAME ... = <literal>;` in a source file. */
function literalOf(file: string, name: string): string {
  const text = fs.readFileSync(file, 'utf8')
  const decl = new RegExp(`(?:export\\s+)?const\\s+${name}\\b[^=]*=`)
  const m = decl.exec(text)
  if (!m) throw new Error(`${name} not found in ${file}`)
  let i = m.index + m[0].length
  while (i < text.length && /\s/.test(text[i])) i++
  if (text.startsWith('new Set', i)) return balanced(text, text.indexOf('[', i))
  if (text.startsWith('new Map', i)) return balanced(text, text.indexOf('[', i))
  return balanced(text, i)
}

function evalLiteral(literal: string): unknown {
  // The discount map's values are enum members; resolve them to their string values.
  const withEnum = literal.replace(/LedgerReferenceType\.([A-Z_]+)/g, (_, k) => {
    const value = (LedgerReferenceType as Record<string, string>)[k]
    if (value === undefined) throw new Error(`unknown LedgerReferenceType.${k}`)
    return JSON.stringify(value)
  })
  return new Function(`return (${withEnum})`)()
}

function sourceOf(file: string, pattern: RegExp): string {
  const text = fs.readFileSync(file, 'utf8')
  const m = pattern.exec(text)
  if (!m) throw new Error(`pattern ${pattern} not found in ${file}`)
  return m[0].replace(/\s+/g, ' ').trim()
}

/** BEFORE: private literal -> value. AFTER: the exported value. */
function privateThenExported<T>(
  name: string,
  file: string,
  exported: T,
  shape: 'set' | 'map' | 'record',
): T {
  if (hasCatalog) return exported
  const value = evalLiteral(literalOf(file, name))
  if (shape === 'set') return (value as unknown[]).map(String) as unknown as T
  if (shape === 'map') return Object.fromEntries(value as [string, unknown][]) as unknown as T
  return value as T
}

// AFTER imports the real exports; BEFORE's imports of private names would fail at
// link time, so they are loaded lazily by namespace where exported only in AFTER.
async function optionalAfter<T>(specifier: string, name: string): Promise<T | undefined> {
  if (!hasCatalog) return undefined
  const mod = (await import(specifier)) as Record<string, unknown>
  return mod[name] as T | undefined
}

const classifierFile = path.join(AREA, 'wallet-audit/classifier.ts')
const auditRunnerFile = path.join(AREA, 'wallet-audit/audit-runner.ts')
const journalFile = path.join(AREA, 'journal-dual-write.ts')
const seasonFile = path.join(SEASON, 'season-deployment-state.service.ts')
const operationalSeasonFile = path.join(SEASON, 'operational-season-id.ts')

async function main() {
  const paymentFamilyGroups = privateThenExported<Record<string, readonly string[]>>(
    'PAYMENT_FAMILY_GROUPS',
    classifierFile,
    (await optionalAfter<ReadonlyMap<string, readonly string[]>>(
      '@/server/services/billing/wallet-audit/classifier',
      'PAYMENT_FAMILY_GROUPS',
    )) as unknown as Record<string, readonly string[]>,
    'map',
  )
  const depositFamilySet = privateThenExported<string[]>(
    'DEPOSIT_FAMILY_SET',
    classifierFile,
    (await optionalAfter<ReadonlySet<string>>(
      '@/server/services/billing/wallet-audit/classifier',
      'DEPOSIT_FAMILY_SET',
    )) as unknown as string[],
    'set',
  )
  const directDepositCharge = privateThenExported<string[]>(
    'DIRECT_DEPOSIT_CHARGE_FAMILIES',
    auditRunnerFile,
    (await optionalAfter<Set<string>>(
      '@/server/services/billing/wallet-audit/audit-runner',
      'DIRECT_DEPOSIT_CHARGE_FAMILIES',
    )) as unknown as string[],
    'set',
  )
  const directDepositRefund = privateThenExported<string[]>(
    'DIRECT_DEPOSIT_REFUND_FAMILIES',
    auditRunnerFile,
    (await optionalAfter<Set<string>>(
      '@/server/services/billing/wallet-audit/audit-runner',
      'DIRECT_DEPOSIT_REFUND_FAMILIES',
    )) as unknown as string[],
    'set',
  )
  const discountMap = privateThenExported<Record<string, string>>(
    'DISCOUNT_ORIGINAL_REFERENCE_TYPE_MAP',
    journalFile,
    (await optionalAfter<Record<string, string>>(
      '@/server/services/billing/journal-dual-write',
      'DISCOUNT_ORIGINAL_REFERENCE_TYPE_MAP',
    )) as Record<string, string>,
    'record',
  )

  const chargeSettlement = (
    await import('@/server/services/billing/charge-settlement')
  ).chargeSettlementReferenceTypes as readonly string[]

  // #3983's predicate: the one live-season subquery, whoever writes it. BEFORE has it
  // inline in each caller; AFTER has it once in `liveSeasonIdSql()`. Compare the SQL
  // itself, not the expression that applies it.
  const liveSeasonPredicate = hasCatalog
    ? sourceOf(
        seasonFile,
        /\(SELECT os\.season_id FROM operational_season os WHERE os\.id = \$\{OPERATIONAL_SEASON_ID\}\)/,
      )
    : sourceOf(
        path.join(AREA, 'business-wallet-list.service.ts'),
        /\(SELECT os\.season_id FROM operational_season os WHERE os\.id = \$\{OPERATIONAL_SEASON_ID\}\)/,
      )

  const pointerConstant = hasCatalog
    ? sourceOf(operationalSeasonFile, /export const OPERATIONAL_SEASON_ID = '[^']*'/)
    : sourceOf(seasonFile, /export const OPERATIONAL_SEASON_ID = '[^']*'/)

  const membership = (list: readonly string[]): Array<[string, null]> =>
    [...new Set(list)].sort().map((t) => [t, null])

  const pairs = (record: Record<string, unknown> | ReadonlyMap<string, unknown>): Array<[string, unknown]> =>
    [...(record instanceof Map ? record.entries() : Object.entries(record))]
      .map(([k, v]) => [k, v] as [string, unknown])
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))

  const scopeInputs = new Set<string>()
  for (const list of [
    Object.keys(WALLET_COLUMN_BY_REFERENCE_TYPE),
    Object.keys(RING_SOURCE),
    Object.keys(NO_RING),
    Object.keys(NOT_ON_TRADER_WALLET),
    [...KNOWN_REFERENCE_TYPE_FAMILIES],
    [...OUTSTANDING_CHARGE_REFERENCE_TYPES],
    [...DEPOSIT_PAID_REFERENCE_TYPES],
    [...DEPOSIT_RETURNED_REFERENCE_TYPES],
    [...chargeSettlement],
    paymentFamilyGroups ? pairs(paymentFamilyGroups).map(([key]) => key) : [],
    depositFamilySet ?? [],
    directDepositCharge ?? [],
    directDepositRefund ?? [],
    Object.keys(MANUAL_ROW_REVERSE_ACTION),
    LEDGER_ENTRY_SUBTYPES.flatMap((s) => s.referenceTypes),
  ]) {
    for (const t of list) scopeInputs.add(t)
  }

  const settlementScope: Array<[string, unknown]> = [...scopeInputs]
    .sort()
    .map((ref) => [ref, resolveSettlementScopeReferenceTypes(ref, null)])
  const settlementScopeWithMetadata: Array<[string, unknown]> = [
    ['meta:NAWLOON', resolveSettlementScopeReferenceTypes('WHATEVER', { originalReferenceType: 'NAWLOON' })],
    ['meta:none', resolveSettlementScopeReferenceTypes('WHATEVER', {})],
  ]

  const out = {
    WALLET_COLUMN_BY_REFERENCE_TYPE: pairs(WALLET_COLUMN_BY_REFERENCE_TYPE),
    RING_SOURCE: pairs(RING_SOURCE),
    NO_RING: pairs(NO_RING),
    NOT_ON_TRADER_WALLET: pairs(NOT_ON_TRADER_WALLET),
    KNOWN_REFERENCE_TYPE_FAMILIES: membership(KNOWN_REFERENCE_TYPE_FAMILIES),
    OUTSTANDING_CHARGE_REFERENCE_TYPES: membership(OUTSTANDING_CHARGE_REFERENCE_TYPES),
    DEPOSIT_PAID_REFERENCE_TYPES: membership(DEPOSIT_PAID_REFERENCE_TYPES),
    DEPOSIT_RETURNED_REFERENCE_TYPES: membership(DEPOSIT_RETURNED_REFERENCE_TYPES),
    chargeSettlementReferenceTypes: membership(chargeSettlement),
    SETTLEMENT_SCOPE_BY_REFERENCE_TYPE: settlementScope,
    SETTLEMENT_SCOPE_METADATA: settlementScopeWithMetadata,
    PAYMENT_FAMILY_GROUPS: pairs(paymentFamilyGroups ?? {}),
    DEPOSIT_FAMILY_SET: membership(depositFamilySet ?? []),
    DIRECT_DEPOSIT_CHARGE_FAMILIES: membership(directDepositCharge ?? []),
    DIRECT_DEPOSIT_REFUND_FAMILIES: membership(directDepositRefund ?? []),
    MANUAL_ROW_REVERSE_ACTION: pairs(MANUAL_ROW_REVERSE_ACTION as Record<string, unknown>),
    LEDGER_ENTRY_SUBTYPES: LEDGER_ENTRY_SUBTYPES.map((s) => [s.key, s] as [string, unknown]).sort(
      ([a], [b]) => (a < b ? -1 : a > b ? 1 : 0),
    ),
    DISCOUNT_ORIGINAL_REFERENCE_TYPE_MAP: pairs(discountMap ?? {}),
    LIVE_SEASON_POINTER: [['OPERATIONAL_SEASON_ID', pointerConstant]] as Array<[string, string]>,
    LIVE_SEASON_PREDICATE: [['sql', liveSeasonPredicate]] as Array<[string, string]>,
  }

  // HARD FAIL: every list must be present and non-empty in both trees.
  const failures: string[] = []
  for (const [name, value] of Object.entries(out)) {
    if (!Array.isArray(value) || value.length === 0) failures.push(name)
  }
  if (failures.length) {
    console.error(`EMPTY LIST(S) in this tree: ${failures.join(', ')}`)
    process.exit(2)
  }

  process.stdout.write(JSON.stringify(out, null, 2) + '\n')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
