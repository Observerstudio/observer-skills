/*
 * Part 2 of the untangle differential: run the money reads the billing screens
 * use, from the tree this file runs in, against one database, and print the
 * result as JSON keyed by wallet id / account id / ledger row id.
 *
 * Run from a tree root:
 *   DIFF_NOW=2026-11-09T12:00:00Z npx tsx money-reads.ts [--root <tree>] [--area <dir>] > before.json
 * Every path below is relative to --root; rewire the '@/' imports at the top
 * to the area you are proving.
 *
 * The functions called are the screens' real service functions (named in the
 * report). Where a screen's entry function lives inline in the tRPC router
 * (the totals tiles), the router's own Prisma reads are reproduced and handed
 * to the same fold (`foldLedgerTotals`) — no hand-written money SQL.
 */

import fs from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'

import prisma from '@/lib/prisma'
import { Prisma } from '@/generated/prisma/client'
import { LIVE_LEDGER_ROWS } from '@/server/services/billing/ledger-visibility'
import { walletColumnSums } from '@/server/services/billing/wallet-column-map'
import { resolveSoftSeasonScopeFilter } from '@/server/services/season/request-season-scope'
import {
  businessWalletListService,
} from '@/server/services/billing/business-wallet-list.service'
import {
  collectionRatioFromSums,
  type CollectionRatio,
} from '@/server/services/billing/collection-ratio'
import {
  DEPOSIT_PAID_REFERENCE_TYPES,
  DEPOSIT_RETURNED_REFERENCE_TYPES,
  foldLedgerTotals,
} from '@/server/services/billing/wallet-ledger-totals'
import { computeOutstandingDebtByWallet } from '@/server/services/billing/outstanding-debt'
import {
  shapeLedgerRow,
  type LedgerEntryForShaping,
  type Translator,
} from '@/server/services/billing/shape-ledger-row'
import { buildLedgerTypeLabeller } from '@/server/services/billing/ledger-type-label'
import { loadManualRowActions } from '@/server/services/billing/manual-row-actions'
import { LEDGER_ENTRY_SUBTYPES } from '@/lib/ledger-entry-catalog'

const { values } = parseArgs({
  options: {
    root: { type: 'string' },
    area: { type: 'string' },
  },
})
const ROOT = path.resolve(values.root ?? process.cwd())
const AREA = path.join(ROOT, values.area ?? 'src/server/services/billing')
const NOW = new Date(process.env.DIFF_NOW ?? '2026-11-09T12:00:00Z')
const PAGE = 200
const SCOPE = { mode: 'ALL' as const }

const hasCatalog = fs.existsSync(path.join(AREA, 'wallet-reference-type-catalog.ts'))

function dec(value: Prisma.Decimal | null | undefined): string {
  return (value ?? new Prisma.Decimal(0)).toFixed(2)
}

function metaOf(metadata: unknown): Record<string, unknown> {
  return metadata && typeof metadata === 'object' ? (metadata as Record<string, unknown>) : {}
}

/** Deterministic translator: the report compares keys/params, not Arabic copy. */
const translator: Translator = (key, values) =>
  values ? `${key}${JSON.stringify(values, Object.keys(values).sort())}` : key
const labeller = buildLedgerTypeLabeller(
  (key) => `label:${key}`,
  (key) => `label:${key}`,
)

function displaySubtypeOf(row: {
  entryType: string
  referenceType: string | null
  metadata: unknown
  catalog: Record<string, { displaySubtype?: string | null }> | null
}): string | null {
  if (row.catalog && row.referenceType) {
    return row.catalog[row.referenceType]?.displaySubtype ?? null
  }
  const meta = metaOf(row.metadata)
  const match = LEDGER_ENTRY_SUBTYPES.find(
    (s) =>
      s.entryType === row.entryType &&
      row.referenceType !== null &&
      s.referenceTypes.includes(row.referenceType) &&
      (s.settlementType === undefined || s.settlementType === meta.settlementType),
  )
  return match?.key ?? null
}

async function loadCatalog(): Promise<Record<string, { displaySubtype?: string | null }> | null> {
  if (!hasCatalog) return null
  const mod = (await import('@/server/services/billing/wallet-reference-type-catalog')) as {
    WALLET_REFERENCE_TYPES: Record<string, { displaySubtype?: string | null }>
  }
  return mod.WALLET_REFERENCE_TYPES
}

async function main() {
  // ---- population: every wallet with at least one live ledger row -------------
  const wallets = await prisma.wallet.findMany({
    where: { ledgerEntries: { some: { voidedAt: null } } },
    select: {
      id: true,
      balance: true,
      billingAccount: { select: { id: true, accountableType: true, accountableId: true } },
    },
    orderBy: { id: 'asc' },
  })
  if (wallets.length === 0) {
    console.error('HARD FAIL: zero wallets with live ledger rows')
    process.exit(3)
  }
  const walletIds = wallets.map((w) => w.id)

  // ---- 1. accounts list, per account -----------------------------------------
  const accounts: Record<string, unknown> = {}
  let offset = 0
  let totalAccounts = 0
  for (;;) {
    const page = await businessWalletListService.listBusinessWallets(
      { limit: PAGE, offset, sortBy: 'combinedBalance', sortOrder: 'asc' },
      SCOPE,
    )
    totalAccounts = page.total
    for (const row of page.rows) {
      const key = row.wallet?.id ?? `account:${row.accountId}`
      accounts[key] = {
        accountId: row.accountId,
        accountableType: row.accountableType,
        name: row.entity?.name ?? null,
        status: row.status,
        ownBalance: row.ownBalance,
        totalSwsBalance: row.totalSwsBalance,
        combinedBalance: row.combinedBalance,
        creditTotal: row.creditTotal,
        debitTotal: row.debitTotal,
        heldTotal: row.heldTotal,
      }
    }
    offset += page.rows.length
    if (offset >= page.total || page.rows.length === 0) break
  }
  if (offset === 0) {
    console.error('HARD FAIL: accounts list returned zero rows')
    process.exit(3)
  }

  // ---- 1b. the same debit / credit / held columns for EVERY trader wallet ----
  // The accounts list shows 31 account ROWS (producers, wholesalers, logistics);
  // the semi-wholesaler traders are its sub-accounts. To cover "every trader
  // wallet with a live row", read the same column fragments the list's CTE uses
  // (`walletColumnSums`) per wallet, live season (the list's ALL scope).
  const seasonScope = await resolveSoftSeasonScopeFilter({})
  const sums1 = walletColumnSums('wl')
  const seasonFilter = seasonScope.seasonId
    ? Prisma.sql`AND wl.season_id = ${seasonScope.seasonId}`
    : Prisma.sql``
  const perWalletRows = await prisma.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
        SELECT wl.wallet_id AS wallet_id,
               COALESCE(SUM(wl.amount), 0)::numeric AS balance,
               ${sums1.credit} AS credit,
               ${sums1.debit} AS debit,
               ${sums1.held} AS held
        FROM wallet_ledger wl
        WHERE wl.voided_at IS NULL ${seasonFilter}
        GROUP BY wl.wallet_id
      `)
  const perWalletById = new Map(perWalletRows.map((r) => [String(r.wallet_id), r]))
  const walletColumns: Record<string, unknown> = {}
  for (const id of walletIds) {
    const r = perWalletById.get(id)
    walletColumns[id] = {
      balance: r ? dec(r.balance as Prisma.Decimal) : '0.00',
      credit: r ? dec(r.credit as Prisma.Decimal) : '0.00',
      debit: r ? dec(r.debit as Prisma.Decimal) : '0.00',
      held: r ? dec(r.held as Prisma.Decimal) : '0.00',
    }
  }

  // ---- 2. transactions totals (the screen's where + foldLedgerTotals) ----------
  const clauses = [
    ...(seasonScope.seasonId ? [{ seasonId: seasonScope.seasonId }] : []),
    LIVE_LEDGER_ROWS,
  ]
  const depositReferenceTypes = [...DEPOSIT_PAID_REFERENCE_TYPES, ...DEPOSIT_RETURNED_REFERENCE_TYPES]

  const [rowsByWallet, credit, debit, byReferenceTypeAll, byReferenceTypeByWallet] = await Promise.all([
    prisma.walletLedger.groupBy({
      by: ['walletId'],
      where: { AND: [...clauses] },
      _count: { _all: true },
    }),
    prisma.walletLedger.groupBy({
      by: ['walletId'],
      where: { AND: [...clauses, { amount: { gt: 0 } }] },
      _sum: { amount: true },
      _count: { _all: true },
    }),
    prisma.walletLedger.groupBy({
      by: ['walletId'],
      where: { AND: [...clauses, { amount: { lt: 0 } }] },
      _sum: { amount: true },
      _count: { _all: true },
    }),
    prisma.walletLedger.groupBy({
      by: ['referenceType', 'entryType'],
      where: { AND: [...clauses, { referenceType: { in: depositReferenceTypes } }] },
      _sum: { amount: true },
    }),
    prisma.walletLedger.groupBy({
      by: ['walletId', 'referenceType', 'entryType'],
      where: { AND: [...clauses, { referenceType: { in: depositReferenceTypes } }] },
      _sum: { amount: true },
    }),
  ])
  if (rowsByWallet.length === 0) {
    console.error('HARD FAIL: transactions totals read zero wallets')
    process.exit(3)
  }

  const totalsWalletIds = rowsByWallet.map((r) => r.walletId)
  const totalWallets = await prisma.wallet.findMany({
    where: { id: { in: totalsWalletIds } },
    select: { id: true, balance: true, billingAccount: { select: { accountableType: true } } },
  })
  const accountTypeByWallet = new Map(
    totalWallets.map((w) => [w.id, w.billingAccount.accountableType]),
  )
  const balanceByWallet = new Map(totalWallets.map((w) => [w.id, w.balance]))

  const depositAgg = (rows: typeof byReferenceTypeAll) =>
    rows.map((r) => ({
      referenceType: r.referenceType,
      entryType: r.entryType,
      sum: r._sum.amount ?? new Prisma.Decimal(0),
    }))

  const totalsAll = foldLedgerTotals({
    rowsByWallet: rowsByWallet.map((r) => ({ walletId: r.walletId, count: r._count._all })),
    credit: credit.map((r) => ({
      walletId: r.walletId,
      sum: r._sum.amount ?? new Prisma.Decimal(0),
      count: r._count._all,
    })),
    debit: debit.map((r) => ({
      walletId: r.walletId,
      sum: r._sum.amount ?? new Prisma.Decimal(0),
      count: r._count._all,
    })),
    accountTypeByWallet,
    balanceByWallet,
    byReferenceType: depositAgg(byReferenceTypeAll),
  })

  const totalsByWallet: Record<string, unknown> = {}
  for (const row of rowsByWallet) {
    const id = row.walletId
    const cr = credit.find((r) => r.walletId === id)
    const db = debit.find((r) => r.walletId === id)
    const one = foldLedgerTotals({
      rowsByWallet: [{ walletId: id, count: row._count._all }],
      credit: cr
        ? [{ walletId: id, sum: cr._sum.amount ?? new Prisma.Decimal(0), count: cr._count._all }]
        : [],
      debit: db
        ? [{ walletId: id, sum: db._sum.amount ?? new Prisma.Decimal(0), count: db._count._all }]
        : [],
      accountTypeByWallet,
      balanceByWallet,
      byReferenceType: depositAgg(byReferenceTypeByWallet.filter((r) => r.walletId === id)),
    })
    totalsByWallet[id] = {
      rows: row._count._all,
      credit: cr ? dec(cr._sum.amount) : '0.00',
      debit: db ? dec(db._sum.amount) : '0.00',
      balance: dec(balanceByWallet.get(id)),
      tiles: one.tiles,
    }
  }

  // ---- 3. outstanding debt (fleet badge) -------------------------------------
  const debtByWallet = await computeOutstandingDebtByWallet(walletIds)
  const outstanding: Record<string, unknown> = {}
  let outstandingTotal = 0
  for (const [id, debt] of debtByWallet) {
    outstanding[id] = {
      total: debt.total,
      byBoatId: Object.fromEntries([...debt.byBoatId].sort(([a], [b]) => (a < b ? -1 : 1))),
    }
    outstandingTotal += debt.total
  }

  // ---- 4. collection ratio, per account and in total --------------------------
  const metrics = await businessWalletListService.getBusinessWalletMetrics({}, SCOPE, NOW)
  const collectionRatioTotal = metrics.collectionRatio

  const collectionRatioByAccount: Record<string, CollectionRatio> = {}
  const accountEntries = Object.values(accounts) as Array<{
    accountId: string
    accountableType: string
  }>
  const ledgerWalletIds = new Set(walletIds)
  const accountIdsWithLiveRows = new Set(
    wallets
      .filter((w) => ledgerWalletIds.has(w.id))
      .map((w) => w.billingAccount.id),
  )
  for (const account of accountEntries) {
    if (!accountIdsWithLiveRows.has(account.accountId)) continue
    const wholesalerIds = account.accountableType === 'WHOLESALER' ? [account.accountId] : []
    const [r] = await prisma.$queryRaw<Array<Record<string, number | boolean>>>(
      businessWalletListService.buildCollectionRatioSql(SCOPE, [account.accountId], wholesalerIds, NOW),
    )
    const sums = (name: 'today' | 'month' | 'season') => ({
      collected: Number(r?.[`collected_${name}`] ?? 0),
      charges: Number(r?.[`charges_${name}`] ?? 0),
      opening: Number(r?.[`opening_${name}`] ?? 0),
    })
    collectionRatioByAccount[account.accountId] = collectionRatioFromSums(
      { today: sums('today'), month: sums('month'), season: sums('season') },
      { book: false, livePointer: r?.live_pointer === true },
    )
  }

  // ---- 5. shaped ledger rows -------------------------------------------------
  const catalog = await loadCatalog()
  const ledgerRows = await prisma.walletLedger.findMany({
    where: LIVE_LEDGER_ROWS,
    include: {
      boat: { select: { id: true, name: true, licenseNumber: true } },
      reversedBy: { select: { id: true } },
    },
    orderBy: { id: 'asc' },
  })
  if (ledgerRows.length === 0) {
    console.error('HARD FAIL: zero live ledger rows shaped')
    process.exit(3)
  }
  const actions = await loadManualRowActions(prisma as never, ledgerRows as never, true)

  const shaped: Record<string, unknown> = {}
  for (const row of ledgerRows) {
    const shapedRow = shapeLedgerRow(
      {
        id: row.id,
        createdAt: row.createdAt,
        actualDateTime: row.actualDateTime,
        entryType: row.entryType,
        amount: row.amount.toString(),
        balanceAfter: row.balanceAfter.toString(),
        description: row.description,
        referenceType: row.referenceType,
        referenceId: row.referenceId,
        metadata: row.metadata,
        boat: row.boat,
      } as LedgerEntryForShaping,
      translator,
      labeller,
    )
    const action = actions.get(row.id)
    shaped[row.id] = {
      displaySubtype: displaySubtypeOf({
        entryType: row.entryType,
        referenceType: row.referenceType,
        metadata: row.metadata,
        catalog,
      }),
      reverseAction: action?.reverse ?? null,
      returnDay: action?.returnDay ?? null,
      description: shapedRow.description,
      typeLabel: shapedRow.typeLabel,
      entryType: row.entryType,
      referenceType: row.referenceType,
      amount: row.amount.toFixed(2),
    }
  }

  // ---- column totals ---------------------------------------------------------
  const accountRows = Object.values(accounts) as Array<{
    creditTotal: number
    debitTotal: number
    heldTotal: number
    combinedBalance: number
  }>
  const accountColumnTotals = accountRows.reduce(
    (acc, r) => ({
      credit: acc.credit + r.creditTotal,
      debit: acc.debit + r.debitTotal,
      held: acc.held + r.heldTotal,
      combinedBalance: acc.combinedBalance + r.combinedBalance,
    }),
    { credit: 0, debit: 0, held: 0, combinedBalance: 0 },
  )

  const out = {
    meta: {
      now: NOW.toISOString(),
      seasonId: seasonScope.seasonId ?? null,
      walletsWithLiveRows: wallets.length,
      accountsListed: totalAccounts,
      accountsCaptured: Object.keys(accounts).length,
      ledgerRowsShaped: ledgerRows.length,
      walletsInColumnRead: Object.keys(walletColumns).length,
      accountableTypes: wallets.reduce<Record<string, number>>((acc, w) => {
        const t = w.billingAccount.accountableType
        acc[t] = (acc[t] ?? 0) + 1
        return acc
      }, {}),
    },
    accounts: Object.fromEntries(Object.entries(accounts).sort(([a], [b]) => (a < b ? -1 : 1))),
    walletColumns: Object.fromEntries(
      Object.entries(walletColumns).sort(([a], [b]) => (a < b ? -1 : 1)),
    ),
    totals: {
      all: totalsAll,
      byWallet: Object.fromEntries(
        Object.entries(totalsByWallet).sort(([a], [b]) => (a < b ? -1 : 1)),
      ),
    },
    outstanding: {
      grandTotal: outstandingTotal,
      byWallet: Object.fromEntries(
        Object.entries(outstanding).sort(([a], [b]) => (a < b ? -1 : 1)),
      ),
    },
    collectionRatio: {
      total: collectionRatioTotal,
      byAccount: Object.fromEntries(
        Object.entries(collectionRatioByAccount).sort(([a], [b]) => (a < b ? -1 : 1)),
      ),
    },
    shapedRows: shaped,
    columnTotals: accountColumnTotals,
  }

  process.stdout.write(JSON.stringify(out, null, 2) + '\n')
}

// Unused placeholder kept out of the hot path; defined so the failed-query
// experiment above never leaves a dangling identifier at compile time.
async function accountsUnused(): Promise<string> {
  return ''
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
