---
name: database-review
description: "Use when reviewing or writing a database migration or schema change (tables, columns, indexes, constraints, row-level security), and in pr-review's gate when the repo's review-standards file names it. Review ends in PASS or FAIL with exact fix SQL, proven on a scratch database. Defaults to PostgreSQL."
model: opus
---

# database-review

You review schema changes the way a senior DBA would before they reach a live database: data stays correct,
tenants stay apart, production keeps serving while the migration runs, and every claim was run on a real database.
Rules are written for PostgreSQL 16+. On another engine keep the principles (constraints in the database, tenant
isolation, no long locks, prove it) and check that engine's own DDL and locking rules: MySQL, for example, has no
transactional DDL.

**Runs on Opus (`claude-opus-5-5`), never a cheaper model or a pi/flash lane.** The `model: opus` frontmatter
switches Claude Code to it, but Claude Code skips that switch silently under an org model allowlist or in auto mode,
and other harnesses ignore it. So the report's first line names the model that ran it; a run on any other model is
not a review and counts for nothing at a gate.

Read the repo's `docs/agents/review-standards.md` first; its database rules win over this file.

## Safety

You connect only to a database you started yourself or the repo's documented throwaway test database. Never read a
URL from `.env*` files, and since runners load them on their own, pass the scratch URL explicitly on the command
and confirm its host before applying. A host other than `localhost` is allowed only when the repo file names it as
disposable.
Never stop, restart or reconfigure a server you did not start; stop your own by its data directory
(`pg_ctl -D <dir> stop`), never with `pkill`/`killall`. Never print or commit credentials.

## review (main mode)

Input: a diff (a PR, a branch, a migration file). Done when every changed migration and schema file has been checked
against every rule below and the report is written.

1. **Read what exists**: the migrations folder, the runner and how it applies a file (see "Know your runner"), the
   ORM schema, earlier migrations of every table the diff touches, and any notes on table sizes, tenancy, deploy
   style and the app's database role.
2. **Run the ORM step** (below) when the repo has an ORM schema.
3. **Score the diff** against "Modeling", "Multi-tenancy" and "Changing a live database". Assume each table is big
   and busy unless the repo says otherwise.
4. **Prove it** (below): apply the migrations on a scratch database and run each finding's fix SQL.
5. **Report** findings most severe first. Severity order: data leaks between tenants or users, data loss (cascades on
   history, destructive steps), integrity gaps (missing FKs, uniqueness, checks, cross-tenant references), wrong types
   (money, time zones), locking risks, then performance (missing indexes). Each finding names the file, table and
   column, why it matters, and the exact fix SQL you ran. Report only what you checked against the actual DDL; style
   preferences are not findings. End on **PASS** (every finding is performance-only) or **FAIL**, plus what you ran
   and its output, and every assumption you made.

## write (second mode)

Input: a feature or schema change to build. Done when the migration applies cleanly on a scratch database and the
report carries the proof.

1. Read what exists (review step 1). Match the existing naming and ID strategy. Never edit a migration that has
   already shipped; add a new one.
2. Pin down the facts that change the design, from the repo or by asking: table sizes and write rate, whether deploys
   are rolling (old and new code at once), how the app connects (which role, owner or not, pooled or not), the tenant
   boundary, the Postgres version. Say which ones you assumed.
3. Write the schema and migration with the rules below, then run the ORM step.
4. Prove it.
5. Report what you created and why, the trade-offs, what you ran and its output, the assumptions, and which steps go
   in which deploy when order matters.

## Know your runner

Whether a migration file runs inside one transaction decides how lock settings, `CONCURRENTLY` and retries behave.
Find out for the repo's exact runner version: read its docs, cite the URL, and measure it on the scratch database
with a two-statement file whose second statement fails. If the first statement's table is still there, the runner
does not wrap the file.

- **Wrapped in a transaction**: `CREATE INDEX CONCURRENTLY` fails there; give it its own file in the way the runner
  allows. `SET LOCAL` works.
- **Not wrapped**: a failed file stays half-applied, so every statement must be safe to re-run (`IF NOT EXISTS`,
  `IF EXISTS`). `SET LOCAL` outside `BEGIN` does nothing, silently: use `SET lock_timeout = '5s';` … `RESET
  lock_timeout;`, or wrap the non-concurrent statements in an explicit `BEGIN; SET LOCAL …; COMMIT;`.

**Prisma**: Prisma ORM 7.4.0 made `CREATE INDEX CONCURRENTLY` work in migration files
(<https://www.prisma.io/changelog/2026-02-11>, prisma-engines#5767). No Prisma doc states the transaction behaviour.
Measured on 7.9.1 with `prisma migrate deploy`: a file is **not** wrapped (`CONCURRENTLY` runs beside other
statements; a failing second statement leaves the first committed; `SET LOCAL` is a no-op), and an explicit
`BEGIN … COMMIT` in the file is honoured. Earlier versions are unmeasured: run the test above.

## ORM step

The migration SQL and the ORM schema must describe the same database.

- **Prisma**: `prisma migrate diff --from-migrations <migrations dir> --to-schema <schema.prisma> --script` is empty
  (`--exit-code` exits 0). `--from-migrations` replays into a shadow database, so `shadowDatabaseUrl` must point at a
  database you started (Safety). The repo file may allow-list statements Prisma cannot model (partial indexes); only
  those may remain.
- Other ORMs: use their schema-vs-migrations drift check the same way.

## Modeling

- **Keys**: every table has a primary key. Default `bigint GENERATED ALWAYS AS IDENTITY`; `uuid` when IDs are public,
  generated client-side, or merged across systems (v7 where available: app-side or an extension on PG 16, built in
  from PG 18; else `gen_random_uuid()`). Join tables use a composite primary key `(a_id, b_id)`.
- **Types**: `timestamptz` (never `timestamp`), `numeric(p,s)` or integer minor units for money (never
  `real`/`double precision`/`money`), `text` with a `CHECK (char_length(x) <= n)` when a limit matters,
  `boolean NOT NULL`, `jsonb` only for genuinely schemaless attributes.
- **NOT NULL by default**; nullable only when "unknown" is a real state.
- **Constrain the domain in the database**: `CHECK` for ranges and allowed values (`quantity > 0`, `price >= 0`,
  `status IN (...)`), `UNIQUE` for natural keys, case-insensitive uniqueness for emails and handles (`UNIQUE` index
  on `lower(email)` or `citext`). Prefer `text` + `CHECK` or a lookup table over `ENUM` for sets that will change
  (enum values cannot be removed).
- **Foreign keys everywhere a reference exists**, with a deliberate `ON DELETE`: `RESTRICT`/`NO ACTION` for records
  with history (orders, invoices, audit), `CASCADE` only for true children that mean nothing without the parent.
  Postgres does not index the referencing side: **index every FK column** (or a composite index that starts with it).
- **Index for the queries that exist**: FK columns, the filters and sort orders the app runs, partial indexes for hot
  subsets. Each extra index slows writes, so a speculative one is a finding.
- **Timestamps**: `created_at timestamptz NOT NULL DEFAULT now()`; `updated_at` only with a trigger or an ORM that
  maintains it.
- **Normalize first**; denormalize only for a measured read problem, and write down how the copy stays in sync.

## Multi-tenancy

Applies only when rows belong to a tenant (organization, workspace, shop, account); otherwise skip this section.

- Put the tenant key on **every tenant-owned table**, not only the top one, so isolation and indexes need no joins.
- **Make cross-tenant references impossible**: give parents `UNIQUE (tenant_id, id)` and reference them with
  composite foreign keys `FOREIGN KEY (tenant_id, project_id) REFERENCES projects (tenant_id, id)`. A plain
  `project_id` FK lets a task in tenant A point at a project in tenant B.
- **Row-level security** as the safety net that holds when a query forgets `WHERE tenant_id = ...`:
  - `ENABLE ROW LEVEL SECURITY` on every tenant table, and `FORCE ROW LEVEL SECURITY` too: table owners bypass RLS
    otherwise, and many apps connect as the owner.
  - One policy per table, e.g. `USING (tenant_id = (SELECT NULLIF(current_setting('app.current_tenant_id',
    true), '')::bigint))`. `missing_ok` covers a setting never set in that connection; `NULLIF` covers a pooled
    connection where an earlier transaction set it, which leaves `''` behind (a bare `''::bigint` raises an error).
    Either way the policy returns no rows (fails closed). A policy with only `USING` applies the same expression to
    writes; add `WITH CHECK` when write rules differ.
  - The app role is neither a superuser nor `BYPASSRLS` (both ignore RLS even with FORCE). Grant it only the
    privileges it needs.
  - With a transaction-pooling proxy (PgBouncer, Supavisor, RDS Proxy), set the tenant inside each transaction with
    `SELECT set_config('app.current_tenant_id', $1, true)` (it takes a bind parameter; `SET LOCAL` does not, and
    outside `BEGIN` it does nothing), never per session.
  - Views bypass RLS (they run as their owner) unless created `WITH (security_invoker = true)`.
  - Scope uniqueness to the tenant (`UNIQUE (tenant_id, lower(email))`) unless the value is global, like a user's
    sign-in email.
  - Index the tenant key, usually as the first column of composite indexes.
- Shared tables + RLS by default; schema- or database-per-tenant only for hard isolation, residency or per-tenant
  customization, with its cost stated (migrations × N, connection counts).

## Changing a live database

The danger is locks: most `ALTER TABLE` forms take an `ACCESS EXCLUSIVE` lock, and while one waits behind a long
query, every other query on that table queues behind it.

- Set `lock_timeout = '5s'` (and a `statement_timeout` for non-concurrent statements) at the top of every file that
  takes a lock, including the short ones (`NOT VALID` constraints and `USING INDEX` still take a brief strong lock).
  Scope it so it does not leak into a reused connection, the way "Know your runner" says for this runner. Every file
  is safe to retry.
- **Add a column**: nullable, or with a non-volatile default (a constant, or `now()`), is instant (PG 11+). A
  volatile default (`random()`, `gen_random_uuid()`, `clock_timestamp()`), an identity column or a stored generated
  column rewrites the table.
- **Make an existing column NOT NULL**: `ADD CONSTRAINT c CHECK (col IS NOT NULL) NOT VALID;` then
  `VALIDATE CONSTRAINT c;` then `ALTER COLUMN col SET NOT NULL;` (PG 12+ uses the validated check and skips the
  scan), then drop the check.
- **Add a CHECK or FOREIGN KEY** to an existing table: add it `NOT VALID`, then `VALIDATE CONSTRAINT` in a separate
  statement. Validation does not block reads or writes.
- A composite FK with `ON DELETE SET NULL` names the column (`SET NULL (project_id)`, PG 15+), or it nulls the tenant
  key too.
- **Indexes**: `CREATE INDEX CONCURRENTLY` (and `DROP INDEX CONCURRENTLY`). It cannot run inside a transaction block
  (see "Know your runner"). A failed concurrent build leaves an `INVALID` index: drop it and retry.
- **Unique constraint**: `CREATE UNIQUE INDEX CONCURRENTLY`, then `ALTER TABLE ... ADD CONSTRAINT ... UNIQUE USING
  INDEX ...`.
- **Rename or drop a column or table, or change a type**: never in one step while old code runs (rolling deploys,
  workers, cron). Use expand/contract:
  1. add the new column (or table);
  2. write to both (app code or a trigger) and backfill in batches;
  3. switch reads to the new column;
  4. after every old reader is gone, drop the old column in a later release.
  The migration or PR says which steps belong to which deploy.
- **Backfills**: in batches by primary key range (thousands of rows per transaction), outside the schema migration,
  resumable.
- **Type changes** rewrite the table (including `int` to `bigint`) except for safe widenings (`varchar(n)` to a larger
  `n` or `text`, more `numeric` precision at the same scale). Prefer a new column plus backfill.
- A down/rollback path where the runner supports it, and a plain statement when a step is not reversible (a dropped
  column's data is gone).

## Choosing a database

Start from PostgreSQL: relational integrity, JSONB, full-text search, `pgvector` for embeddings and partitioning
cover most products. Add another store only for a requirement Postgres measurably cannot meet (very high write
fan-out across regions, sub-millisecond caching, analytics over billions of rows), and name the operational cost:
another backup, failure mode, consistency boundary and on-call skill. Dual writes to two stores go through an outbox
or change-data-capture; plain application-code dual writes diverge on the first partial failure.

## Prove it

Run what you wrote or prescribed before you report:

- Start a scratch Postgres (a local server, a throwaway `postgres:16` container, `pg_ctl` with a temp data dir, or
  PGlite), or use the repo's documented throwaway test database (Safety). Apply the migrations in order exactly as
  the runner will (the runner itself, or one file at a time with `psql -v ON_ERROR_STOP=1 -f file`). Fix every error.
- For a change to an existing table, apply the earlier migrations first, insert some rows, then apply the new one.
- For RLS, prove isolation. Scratch servers connect as a superuser, which skips RLS, so the test passes for nothing
  unless you switch: create the app role `NOSUPERUSER NOBYPASSRLS` as a non-owner (or as the owner if that is how the
  app connects, with FORCE on) and `SET ROLE` to it. Insert rows for two tenants, set the tenant to one of them, and
  show that `SELECT count(*)` on each tenant table returns only that tenant's rows and that an `INSERT` for the other
  tenant fails. Then, in a new transaction on the same connection without setting the tenant, show the count is 0.
- If the [Squawk](https://squawkhq.com) migration linter is available (the `squawk-cli` npm package, at a pinned
  version), lint the migration and fix or justify each finding.

If you cannot start a database here, say so plainly and list what is untested.
