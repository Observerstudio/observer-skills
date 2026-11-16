# General checks

Valid in every repo. Score each PASS / FAIL / N/A with one line of evidence. The repo's own checks
(`docs/agents/review-standards.md`) are scored on top, in the same shape.

| # | Check | Evidence |
|---|-------|----------|
| 1 | **Spec match** | Scored against the brief's `.feature` file: every `Scenario:` title is, verbatim, the `it()` title of a test that is green in the gate run, or the PR states the deferral. That test asserts the scenario's expected outcome; a title-only or empty test fails the check. No `.feature` for a code-writing lane means the brief was wrong, not the lane: fix the brief, then score. Name the scenario that is missing. |
| 2 | **Meaning, not just safety** | For any closed set of verdicts, classifications or statuses: one POSITIVE fixture per member exists and the healthy path asserts the *clean* verdict. A negative control proves nothing about meaning. |
| 3 | **Mutation controls bite** | The PR body pastes red output for each guard, and each control kills exactly the guard it claims. A guard with a redundant sibling says so: a single mutation can survive a redundant guard. |
| 4 | **Diff hygiene** | `git diff --numstat` per file is proportional to the change. Whole-file rewrites (CRLF loss, `prisma format`, reformatters) FAIL. Schema changes are additive and small. |
| 5 | **Repo rules held** | Every rule the repo's review-standards file points at (its `AGENTS.md` hard rules and engineering standards): name each one the diff touches and whether it held. A refactor PR that changes behaviour, an edit in place of an append, an outbound call with no timeout, a second derivation of one fact, or a cross-area import outside the published index FAILs here. |
| 6 | **What it deletes** | The PR names what it removes or corrects (a wrong comment, a dead test, a superseded guard); "nothing" is acceptable only when stated. Run `ponytail-review` against the PR diff: an abstraction with one caller, a guard for a caller that does not exist, or a helper the stdlib already provides FAILs here. |
| 7 | **Machine pre-checks** | Run before reading the code, paste the tail. New or bumped dependencies: the ecosystem's audit (`npm audit --omit=dev`, `pnpm audit --prod`, `pip-audit`, `cargo audit`) shows no new high or critical. Changed files: `git diff <base>...HEAD -U0 \| grep -iE "(api[_-]?key\|secret\|password\|token)['\"]?\s*[:=]\s*['\"][^'\"]{8,}"` finds nothing. A tool not installed is stated, not skipped silently. |
| 8 | **Load and await shape** | Every changed data read: no query inside a loop over rows (N+1; batch it or join), no unbounded read of a growing table or relation (no `take`/pagination, or a nested relation loaded whole when one row is used), no large JSON column pulled where a scalar would do. Every changed async call: awaited, returned, or explicitly handled; a floating promise FAILs. Name the read and its expected row count. |

## When a check fails

- FAIL on 2 → rework before the gate.
- FAIL on 4 → rework (cheap, and it protects every other branch).
- FAIL on 7 (a new high/critical advisory or a hard-coded secret) → rework, never accepted.
- FAIL on 1, 3, 5, 6, 8 → rework unless the gap is stated in the PR body and accepted in the gate comment.
- The repo's own checks carry the rule the repo gives them.
