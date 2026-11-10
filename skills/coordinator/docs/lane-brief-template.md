# Lane brief template

The brief format that works. A lane is an OpenCode pane driven by a coordinator (see
[coordinator-playbook.md](coordinator-playbook.md)). The brief below is the contract:
if a decision is not in the brief, the lane must not make it.

Fill it in as written; keep every section even when short.

## Template

```markdown
# <Short imperative title>

Issue: <link>

## Worktree + branch
- Worktree: `.worktrees/<name>` — symlink `node_modules` and the generated-code
  directories from the root checkout, then run codegen ONCE.
  The generated output is SHARED through the symlink: a regenerate hits every lane.
- Branch: `<branch-name>` (respect the repo's branch-naming rules).

## Pattern to copy
Mirror these shipped files, in reading order:
1. <path/to/existing/file.ts>
2. <path/to/other/existing/file.ts>

## Standards / reference
- Standards: <S# ...> — cite every engineering standard this brief applies.
- Reference used: <none — the repo standards cover this> or <book/paper/primary source + section>.

## Scope
What changes — with file:line for EVERY writer and reader involved:
- <change> (<file>:<line>)

What does NOT change (hard rules):
- <invariant>

## Tests
Acceptance file: `.worktrees/LANE-ACCEPT-<issue>.feature` — one it() per Scenario, titles verbatim (see Acceptance below).
Pin: <behavior>. Fixture-scoped ONLY — create your own rows, filter every assertion
by your own ids, never assert raw table counts.
Integration files are WRITTEN not run: when done, print LANE-NEEDS-INTEGRATION-SLOT.
Local runs are the test files you touched ONLY — never the full unit suite, tsc, or `next build` on this
machine (Ahmed 2026-09-13: CI runs those on the PR; the laptop does not).
Teardown deletes your own rows in FK order.

## TDD — the order of work (since 2026-09-12)
Test first, then code. For every behaviour change in Scope: write the test case from the
fixture contract BEFORE touching the implementation, run that one file, and paste its RED
output into your report. Then implement, run again, paste GREEN. A test that was never red
proves nothing — but a red is evidence only when its failure message names the missing
behaviour; a red from a fixture or import error proves nothing either, so read it. The
coordinator's gate still deletes the wired code once to confirm only the dependent cases go red. Commit the test and the implementation together (red never merges).
When a change has no honest test (a UI-only mirror in a repo with no component harness),
say so in the report instead of inventing one.

### The fixture contract — write this section, don't leave it to the lane

A lane forbidden from running the integration suite cannot discover fixture mistakes, and fixture
mistakes are exactly the class only a real database reveals. Every one it makes costs a full
round-trip through the coordinator and a serialised slot run. Four rounds on one test taught this;
the feature code was never wrong once. So the brief names, explicitly:

- **The seeding pattern file, by path and line range.** "Follow `<file>:60-105`" beats "create a
  fixture". Every writer nature has a sibling test that already seats its rows correctly.
- **Which rows the nature actually needs.** A `move_selected_items` nature needs real rows in the
  source's bucket, plus the matching inventory-projection row — not just the parties. A
  quantity-only nature needs neither. Say which.
- **The shared-uniqueness helpers, and their semantics.** Name the reservation helper for any
  globally-constrained fixture (season windows, codes, serials) and state what it returns — ours
  reserves exactly ONE day, so dates come from its return value, never hand-picked. Hand-picked
  values work until two files pick the same one, which has already happened.
- **Slug vs legacy enum.** Say which representation the boundary takes, and name a sibling call
  site. Two nearly-identical fields, one of which silently produces a wrong row, is a coin flip.
- **Isolation per test.** One actor per test, sessions/grants closed or scoped, so test 2 cannot
  inherit test 1's state — a leaked session makes a "no session" test pass for the wrong reason.
- **Teardown that survives a failed setup.** Guard it: a throwing `afterAll` poisons every
  neighbouring suite on the same worker, turning one fixture bug into a suite-wide red.

**Coordinator's own half of this:** read the lane's test file BEFORE spending a slot run on it.
A hardcoded date, a missing role, an unseeded row and a leaked session are all visible by eye in
thirty seconds; the slot run costs minutes and is serialised machine-wide.

## Acceptance — the Gherkin file is the gate (since 2026-09-13)
The coordinator writes `.worktrees/LANE-ACCEPT-<issue>.feature` next to the brief: one `Feature`,
one `Scenario` per acceptance criterion, plain Given/When/Then, one observable outcome each, in the
domain's words (order, invoice, receipt), never implementation words (table, column, hook). Pointer to
it goes in the brief's Tests section.
The lane maps scenarios to tests 1:1: each `Scenario:` title becomes the `it()` title VERBATIM. Unit
scenarios get the red-first run above from the lane; integration scenarios are WRITTEN by the lane and
run red-first by the coordinator in the slot (the brief forbids the lane running them). The report and the PR body carry the whole
`.feature` plus a `scenario → test file:line` table. A scenario with no test is a LANE-BLOCKED
(missing fixture, no honest harness), never a silent skip. The lane never edits the `.feature`; a
scenario that turns out wrong comes back as LANE-BLOCKED with the reason.
Gate: `pr-review` general check 1 is scored against the `.feature`, not the issue prose — every scenario title
greps to a green test, or the PR states the deferral.

Example (one scenario is enough to show the shape):
```gherkin
Feature: Day sheet print survives corrections
  Scenario: a corrected line prints its current quantity as a plain number
    Given a customer day with one order line adjusted from 5 to 3 units
    When the day sheet is read for printing
    Then the line shows 3
```

## Simplicity
Ponytail is ON for every code-writing lane: build the simplest thing that satisfies this brief —
YAGNI → stdlib → native → one line → minimum. Before opening the PR run `/ponytail-review` on your
own diff and fix what it names (or state in the PR body why not).

## Delivery
Small commits. No push unless told. No PR unless told. NEVER amend pushed commits.
Finish by printing EXACTLY one sentinel line:
- LANE-DONE-<issue> — <branch> <sha> <one-line summary>
- LANE-BLOCKED-<issue> — <what + the options>
(LANE-NEEDS-INTEGRATION-SLOT is printed earlier, when the integration files are written; it is not the final line.)
Idle is NOT finished — only the sentinel counts.

## STOP conditions
Any decision this brief reserves → LANE-BLOCKED with options. Never pick.
```

## Worked example (generic repo)

```markdown
# Add stable server-side sort to the orders list endpoint

Issue: #482

## Worktree + branch
- Worktree: `.worktrees/wt-482` — symlink node_modules and .generated from the root
  checkout, run `npm run codegen` once.
- Branch: feat/482-orders-stable-sort

## Pattern to copy
1. src/server/services/customers-list.service.ts   (sort-key validation style)
2. src/trpc/routers/customers.router.ts            (input schema shape)

## Scope
Changes:
- orders.list input gains sortBy/order enum fields (src/trpc/routers/orders.router.ts:31)
- OrdersListService.applySort adds stable tiebreak on id (src/server/services/orders-list.service.ts:88)
Does NOT change:
- Existing default ordering for callers that omit sortBy.
- Response shape.

## Tests
Pin: sort by createdAt asc/desc is stable across equal timestamps; ties break on id.
Fixture-scoped: create two orders with identical timestamps under THIS fixture's
customer id, assert on those ids only. Integration file written, not run.

## Delivery
Small commits. No push unless told. No PR unless told. NEVER amend pushed commits.
Sentinel lines exactly as specified in the playbook.

## STOP conditions
Choosing the default sort key is reserved → LANE-BLOCKED with options if not stated.
```

## Teardown discipline (integration files)

An integration test that writes shared-ledger rows must delete its own rows in FK
order, scoped to its own ids. Deletion order is load-bearing whenever a nullable FK is
declared `SetNull` while a CHECK constraint still expects a value: deleting the parent
UPDATEs the child row into a state no branch of the CHECK accepts, and Postgres
reports a misleading check-constraint violation ("new row for relation …") that points
away from the real cause — so delete the child before the parent.

> **Example from a production app:** four tables hold the ledger table under
> `onDelete: Restrict` and must go before it; one table combines a SetNull foreign key
> with a CHECK constraint, which makes its deletion order load-bearing.
