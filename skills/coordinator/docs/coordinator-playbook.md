# Coordinator playbook — Claude as coordinator, OpenCode lanes

The operating model, as practiced. Each product repo pins its own specifics (paths,
commands, protected-branch vocabulary) in its own agent docs — usually `docs/agents/`
plus the repo's `CLAUDE.md`. This page is the shared model. Where a rule needs a
concrete shape, look for the **Example from a production app** blocks.

## Roles

- **One Claude session per work track = the coordinator** (one herdr tab per track).
  The coordinator diagnoses, writes briefs, gates, merges, talks to the human. It does
  **NOT** write feature code — even urgent fixes go to a lane.
- **Lanes are OpenCode panes INSIDE the coordinator's own tab**, spawned by it.
- Coordinators of other tracks are **peers**: message them for direction, never
  dispatch them, never touch another tab's panes.
- A designated **Master coordinator** arbitrates cross-track questions.

## The graph

The operating model is a declared graph — see [graph.md](graph.md). Three routers decide the
path from tables (ASSIGN: dev or coordinator; SENTINEL: DONE / BLOCKED / NEEDS-SLOT / silence;
VERDICT: pass / reject), every dashed loop-back has a ceiling of two before it routes to a
human, and one state file per track ([track-state-template.md](track-state-template.md)) rides
the edges so nothing is re-explained. The gate below is the VERDICT router's input.

> **Example from a production app (2026-09-09):** one audit finding went round the reject edge twice on
> the same test fixture before the third brief named the exact lookup by file and line. The
> ceiling now makes round three a human decision, not a fourth lane turn.

## The gate (every PR, no exceptions)

1. Cold review at the exact SHA, running `pr-review` gate mode
   ([`pr-review/SKILL.md`](../../pr-review/SKILL.md)) — ONE verdict (yours), then `merge-risk`.
   Who runs the passes: [`SKILL.md` § The gate](../SKILL.md#the-gate--every-pr-no-exceptions).
2. CI green.
3. The coordinator's **own** local run of the lane's integration suite (see
   [integration slot](#integration-slot)).
4. Merge commit, always (`gh pr merge --merge`).

- Green checks are NOT readiness: an empty `reviewDecision` means unreviewed.
- A PR that conflicts with its base gets **NO CI run at all** — no suite, which looks
  like a stuck queue. Check `gh pr view N --json mergeable` before blaming the queue;
  the fix is rebase onto base as a **new branch + new PR**, not a force-push.

## Never force-push

Amended history → fresh ref + new PR. Follow-up commits only.

Branch names must respect the repo's protected-branch vocabulary.

> **Example from a production app:** branch names must not contain `master`.

## Integration slot

Some suites are exclusive machine-wide: two concurrent runs delete each other's
database state. Treat that suite as **one slot per machine**, held like a lock:

- Announce **before** taking it; the granting coordinator confirms nothing is live
  (a process check for the suite's runner).
- Print `SLOT-RELEASED` when done.
- **Never dispatch a lane to run the exclusive suite** — coordinators take the slot
  themselves.

> **Example from a production app:** the slot is `vitest --project=integration` (one run
> machine-wide; two runs delete each other's database). Before taking it the grantor
> confirms nothing is live: `pgrep -f "vitest run --project=integration"`.

## Standing rules

- **Never over-engineer** — build what the client spec text asks, nothing around it.
- A guard for a caller that does not exist in production data is an issue, not a gate.
- **Verify premises on the production-shaped copy**: count rows before saying
  "blocker"; read the writer's input-contract doc comment before calling a NULL column
  a bug — a deliberate omission looks identical to a missed stamp.
- Displayed money is business logic.
- Repair data, don't tolerate it.
- The client gives needs; **we choose the mechanism**.
- Client-facing text goes in the client's language; English in the terminal.

> **Example from a production app:** client-facing updates are written in the client's own language, in plain words;
> everything in the terminal stays English.
- **Never repeat work.** Before dispatching, check the handoff file, open PRs, recent
  merges, and the issue — done, in-flight, and decided all look like "todo" from a cold
  start.
- **Never break what already works.** Shipped behaviour is a contract: mirror shipped
  patterns rather than rewriting shipped surfaces in the same PR, keep migrations
  additive, and when a pre-existing test goes red, upgrade it to name its fixture —
  never weaken an assertion to get green.

## Evidence standards

- **Mutation proofs for tests**: delete the wired code → ONLY the dependent cases go
  red. All-red or none-red proves nothing.
- Zero-writes claims are **verified with row counts**, not asserted.
- Findings go to dated note files and merge via PR. Each repo defines where notes live.

> **Example from a production app:** findings land in `docs/notes/YYYY-MM-DD-*.md`.

## Related Observer repos

- [command-skill](https://github.com/Observerstudio/command-skill) — how briefs and
  instructions to agents are written so they execute cleanly.
- [orchestrate-skill](https://github.com/Observerstudio/orchestrate-skill) — the same
  philosophy applied to orchestrating multiple agents across a body of work.
