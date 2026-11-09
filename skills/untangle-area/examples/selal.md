# Selal — the worked example

Selal is the 3,000-file Next.js + tRPC + Prisma codebase this skill was first
written against. Everything below is history, not part of the skill: the same
moves apply to any repo, with its own area names.

## The billing study (#3980) — the standard

A hand-pass over `src/server/services/billing/` and the wallet screens found
43 problems and produced 10 fixes. Every problem carried a `file:line`, every
fix sat above the problems it solved, and every money-rule change went to
Ahmed as a decision instead of being implemented.

The proof: `untangle-diff` dumped the billing lists and ran the screens' real
service reads against one production copy before and after, with the same
`DIFF_NOW`, and compared the JSON field by field. The run printed the row
counts and `differences: 0`.

## Areas that came next

- **return-log** was the first area for this skill. Its hotspot was
  `src/components/logistics/return-log-form.tsx` (5,551 lines); the area was
  the form plus `src/server/services/return-log/**` and their direct import
  neighbours.
- **sell** was next, led by `src/components/logistics/sell-log-form.tsx`
  (5,193 lines).
- The hidden links that made the case: `wallet-column-map.ts:26` and
  `wallet-row-ring.ts:150` (plus 174 and 202) each kept their own
  `reference_type` vocabulary, and the billing reference-type catalog was the
  intended single owner. Ten such lists existed at commit `f0da23300`.

## Scanner commands for Selal

The scanners live in the skill's `scripts/` folder. Run them against the repo
from the skill folder:

```bash
node scripts/hotspots.mjs     --root /path/to/selal --out /path/to/selal/tmp/untangle-evidence
node scripts/coupling.mjs     --root /path/to/selal --out /path/to/selal/tmp/untangle-evidence
node scripts/import-graph.mjs --root /path/to/selal --out /path/to/selal/tmp/untangle-evidence
node scripts/special-cases.mjs --root /path/to/selal --out /path/to/selal/tmp/untangle-evidence \
  --label return-log --schema prisma/schema.prisma
node scripts/vocab-lists.mjs  --root /path/to/selal --out /path/to/selal/tmp/untangle-evidence \
  --label return-log --only src/server/services/return-log
```

`--schema prisma/schema.prisma` enables the enum-list detector. It reads the
`enum` blocks in the Prisma schema; on another repo pass whichever enum schema
it has, or omit it.

If the target repo has no `node_modules` installed, point every AST scanner
at another checkout's compiler rather than installing a dependency — set
`TS_MODULE` once and all three AST scanners pick it up:

```bash
export TS_MODULE=/path/to/anywhere/node_modules/typescript
node scripts/special-cases.mjs --root /path/to/selal --out /tmp/ua --schema prisma/schema.prisma
node scripts/import-graph.mjs  --root /path/to/selal --out /tmp/ua
node scripts/vocab-lists.mjs   --root /path/to/selal --out /tmp/ua --min 8
```

(`--typescript <module>` does the same per command.)

## The proof adapters

The generic proof template is `proof-template/compare.js` plus the described
pattern in `SKILL.md`. Selal's two adapters are kept here as the worked
adapter, not as required code:

- `examples/selal/proof-template/dump-lists.ts` — imports the billing lists
  and prints them as sorted JSON. It rewires the list names at the top and
  falls back to reading a private literal from source only for the before
  tree, where the owner module did not export it yet.
- `examples/selal/proof-template/money-reads.ts` — calls the billing screens'
  real service functions (`businessWalletListService`, `foldLedgerTotals`,
  `computeOutstandingDebtByWallet`, `shapeLedgerRow`, …) against one database
  and prints the result keyed by wallet/account/ledger-row id.

Both take `--root <tree>` and `--area <src/server/services/<area>>`, read
`DIFF_NOW`, and exit non-zero on zero rows. Copy them into the before and after
trees, rewire the `@/` imports for the area being proved, then run each adapter
in **both** trees and compare both dumps:

```bash
# in the before tree
npx tsx proof-template/dump-lists.ts  --root . --area src/server/services/return-log > ../before/lists.json
DIFF_NOW=2026-11-09T12:00:00Z npx tsx proof-template/money-reads.ts --root . --area src/server/services/return-log > ../before/reads.json
# in the after tree
npx tsx proof-template/dump-lists.ts  --root . --area src/server/services/return-log > ../after/lists.json
DIFF_NOW=2026-11-09T12:00:00Z npx tsx proof-template/money-reads.ts --root . --area src/server/services/return-log > ../after/reads.json
# compare the list dump and the read dump
node proof-template/compare.js --before ../before/lists.json --after ../after/lists.json
node proof-template/compare.js --before ../before/reads.json --after ../after/reads.json --out differences.json
```

## Money hold, in Selal terms

A fix that changes a balance, a ledger column, a receipt, a statement date or a
collection ratio is a business decision. Mark it `blocked: NEEDS-AHMED` with
the exact `file:line` and the production count that shows the current answer.
Never recommend the wrong record because it is cheaper to build.

## The mandatory test prompt

The test protocol's concrete case was:

```text
Untangle the return-log area. Do not change src/. Stop after the decision log
and tickets: docs/untangle/return-log.md, docs/untangle/cross-area.md, and a
list of tickets.
```

The with-skill run passed by finishing the map and decision log without reading
outside return-log plus its direct import neighbours, with every finding
confirmed by an independent reviewer. The no-skill run read billing files,
produced claims without `file:line`, and ran out of context.

## The lock, in Selal terms

Selal's stay-untangled build added `scripts/untangle/rules/` (arch tests with
JSON baselines under `scripts/untangle/baselines/`) and oxlint rules with
frozen `off`-overrides in `.oxlintrc.json`; `npm run untangle:baseline`
shrinks a baseline and never grows it. A fix lands by lowering the owning
baseline or adding the owner registration, so the area cannot slide back.
