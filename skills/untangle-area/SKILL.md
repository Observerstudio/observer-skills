---
name: untangle-area
description: Untangle one area of a large codebase end to end — map, decision log, tickets, gate, production-copy proof and a lock — without loading the whole repo.
disable-model-invocation: true
argument-hint: "[area]"
---

# Untangle one area

Run this only when a person asked for it by name. If you loaded it on your own, stop and ask first. Area: $ARGUMENTS (if empty, step 0 picks one after the map).

**Core question, for every piece: should these pieces change together?**

A codebase too big to hold at once gets untangled one area at a time. A whole-repo pass fails when thousands of files cannot fit in context; this version buys evidence with scripts and spends context on one area plus its direct import neighbours.

The output is a decision log and its tickets, not a stack of drive-by fixes. A fix lands through a lane and the gate, with a production-copy proof that the numbers did not move.

## 0. Set the area

Take the area from the argument. If none is given, run the map and pick the highest hotspot area with no completed decision log.

An area is a feature, not a folder: the screens, the services behind them, and their direct import neighbours.

Write `docs/untangle/<area>.md` as the primary handoff and the only durable memory of this area's run. A new session resumes from that file, not from a previous conversation. `docs/untangle/cross-area.md` is a separate shared index of links that cross areas (step 2), not part of this area's log.

**Done when:** the area name, its files, and the decision-log path are written at the top of `docs/untangle/<area>.md`.

## 1. Map, don't read

Run the scanners in this skill's `scripts/` folder against the target repo. They are the map; no file is opened until step 2. Set `SKILL_DIR` once to the folder holding this `SKILL.md`, then every command runs the skill's script and passes the target repo through `--root`. The AST scanners need the repo's own TypeScript; if its dependencies are not installed, pass `--typescript <module>` or set `TS_MODULE`.

| Question | Command |
|---|---|
| What changes most, and where? | `node "$SKILL_DIR/scripts/hotspots.mjs" --root <repo> --out <repo>/tmp/untangle-evidence` |
| What always changes together? | `node "$SKILL_DIR/scripts/coupling.mjs" --root <repo> --out <repo>/tmp/untangle-evidence` |
| What imports what, and where are the cycles? | `node "$SKILL_DIR/scripts/import-graph.mjs" --root <repo> --out <repo>/tmp/untangle-evidence` |
| Where are the special cases? | `node "$SKILL_DIR/scripts/special-cases.mjs" --root <repo> --out <repo>/tmp/untangle-evidence --label <area>` |
| Where are the hand-kept vocabulary lists? | `node "$SKILL_DIR/scripts/vocab-lists.mjs" --root <repo> --out <repo>/tmp/untangle-evidence --label <area>` |

`--source <dir>` overrides the source tree (default: `<repo>/src` when it exists, else the repo root). If the repo has an enum schema, add `--schema <file>` to `special-cases.mjs`; without it the enum-list section is skipped and every other detector still runs.

Read the markdown summaries, not every JSON row. The useful signals are the top hotspot files, the co-change pairs that cross folders, the import edges into and out of the area, and the special-case counts per area.

**Done when:** `tmp/untangle-evidence/` holds all five outputs, none is empty, and `docs/untangle/<area>.md` records the area's top files, its co-change partners, and its import neighbours.

## 2. Spend context on the area only

Read the area and its **direct import neighbours**, both directions. Read signatures first; open a body only when a finding needs it. Search for a symbol instead of reading a giant file whole.

Never load another area. When a link crosses areas, write it to `docs/untangle/cross-area.md` and leave the other side to its owner:

```md
- `<area>/x.ts:42` → `<other-area>/y.ts`: <the link>; owner area: <other-area>; found by: <area>.
```

Give subagents the same boundary and the same demand: `file:line` evidence, never a summary of another area.

**Done when:** the files read are inside the area or its direct neighbours, and every cross-area link is in `cross-area.md` with a `file:line`.

## 3. Find the problems, in four kinds

There are only three ways pieces get tied wrongly, plus one symptom that exposes the requirement the design missed.

**Hidden links** — pieces that must change together and the code does not show it.

- copies of logic or values (two modules each keep their own copy of the same status vocabulary);
- a module reading a global or file another module sets;
- a feature split across folders by layer, so one change needs all of them;
- a call order or convention callers simply have to know.

**Needless links** — pieces tied together that change for different reasons.

- callers depending on internals;
- stable code importing something more volatile;
- a general function with a parameter only one workflow understands;
- a shallow module whose interface changes whenever its internals do.

**Surplus** — pieces with no reason of their own to change: pass-through wrappers, speculative generality, dead code.

**Special cases** — code that exists for one situation instead of following from how the system works: an `if` for one value, a parameter for one caller, a swallowed exception, a retry or sleep, a disabled test. Each one is a requirement the design never accounted for; use them to work out what the system needs to be.

Write the decision log in the worked example's form: **fixes above the problems they solve**, every item with `file:line`, and a status line per fix. An item without a citation is removed.

```md
# Untangle <area> — decision log
Status: map complete / fixes proposed
Last updated: 2026-11-09

## Fix 1 — <the one change> — status: proposed #<ticket>
- `<file>:<line>` ...
- `<file>:<line>` ...
```

Statuses: `proposed #<ticket>`, `landed #<PR>`, `blocked: NEEDS-AHMED <why>`, `cross-area: <area>`.

**Done when:** every production file in the area and its direct neighbours either appears under a finding or is recorded as clean, every finding cites `file:line`, and every fix has a status. An independent reviewer can open every citation and confirm the finding without reading the log's prose.

## 4. Redesign from first principles

Work out the fix as if the system had known today's requirements from the start. Look for the one change behind several problems; it often looks nothing like them.

Test every fix with the same question: pieces that change together end up together, pieces that don't aren't tied, and everything depends on what changes less.

**Money hold.** This skill may find money problems; it may not change a computed value. A fix that changes a balance, a column, a receipt, a date, or a ratio is a business decision: mark it `blocked: NEEDS-AHMED` with the exact `file:line` and the production count that shows the current answer. Never recommend the wrong record because it is cheaper.

**Done when:** each fix names the problems it solves, and every money-rule change is marked `NEEDS-AHMED` instead of implemented.

## 5. Ship our way

Tickets go out with the repo's ticket workflow, then lanes, then the gate. This skill stops at a decision log with tickets and statuses; implementation belongs to a lane.

Give each ticket:

- the fix in business words first, then its `file:line` problems;
- what it deletes or refuses to add;
- its acceptance test — normally that its keys disappear from the owning frozen baseline;
- for money code, the production-copy proof and the `NEEDS-AHMED` decision it depends on.

**Done when:** every proposed fix has a ticket number or a blocked reason, and the decision log's status lines match the tracker.

## 6. Prove behaviour did not change

Any fix that touches money, custody or a dated book is proven on a production copy before merge. The pattern is always the same:

1. **Dump the lists.** Before and after, print every vocabulary/list the area owns as sorted JSON. Fail closed when any list is empty.
2. **Dump the money reads.** Before and after, call the screens' real service functions against one database with the same fixed clock (`DIFF_NOW`), and print the result keyed by the row ids the screens show. Fail closed on zero rows or zero accounts.
3. **Compare.** `node proof-template/compare.js --before before.json --after after.json --out differences.json` walks both dumps field by field.

`proof-template/compare.js` is the generic comparer: exit 0 only when every sampled value is identical, exit 1 on any difference or an empty dump, exit 2 on a read/parse error. Copy it into both trees, or run it once against the two dumped files.

The adapters that know a particular area's lists, imports and service reads are written per area — the worked example in `examples/` shows two. Rewire the imports and the list names, keep `--root`, and paste the commands, the row counts and `differences: 0` into the PR body. If a difference is real and intended, it is a money decision and needs the owner's approval before the ticket can land.

**Done when:** the counts are non-zero in both trees and `compare.js` reports `differences: 0`, or the only differences are the approved money decision and its count is pasted.

## 7. Lock it

A fix ends by making the area unable to slide back. Lower the baseline entry that the fix removes, or add the owner registration for the one fact the fix consolidated.

The owning check is whatever the repo uses for financial invariants: an architecture test with a committed baseline, a lint rule with a frozen file list, or a registry of owned facts. Add a file to a frozen list only through that check's generator, never by hand; an `off` override is not a place to park a new finding. Baselines only shrink. The worked example's exact paths are in `examples/`.

**Done when:** the ticket that lands the fix also lowers a baseline or adds an owner registration, and the owning test goes red when the old entry is put back.

## 8. Resume

`docs/untangle/<area>.md` is the handoff. Every new session reads it first, then the map outputs, then the area. It does not re-derive discovered facts or re-read another area.

Update the file at each natural break: status lines, new `NEEDS-AHMED` items, cross-area links, and the next area.

## Red flags — stop and correct

- Reading a whole file to find one symbol, or any file outside the area and its direct neighbours.
- A finding without `file:line`; a summary offered instead of a citation.
- A cross-area claim in the decision log instead of `cross-area.md`.
- A fix with no ticket and no status line.
- A computed value changed because the fix "looks equivalent".
- A baseline or an `off` override grown by hand.
- Running the with/without test yourself instead of handing it to the coordinator.

After the baseline run, replace this list with the exact rationalisations the no-skill pane used, and delete the ones that did not occur.

## Worked example and proof

- The study that set the standard, the areas that came next, the scanner commands for that repo, and the two proof adapters are in [`examples/`](examples/).
- `proof-template/compare.js` is generic; adapters like the two in the example are written per area.

## Test protocol (the coordinator runs it)

Use the skill-creator eval loop with fresh panes, not the lane. Each case runs twice in the same turn: `with_skill` (pass this skill's path) and `without_skill` (no skill).

Workspace: `.agents/skills/untangle-area/workspace/iteration-1/<case>/with_skill/outputs/` and `.../without_skill/outputs/`. Write `eval_metadata.json` beside each case with `eval_name`, `prompt`, `assertions`. Save each run's `timing.json` when it finishes.

**Mandatory case — `<area>-map`:**

```text
Untangle the <area> area. Do not change source files. Stop after the decision
log and tickets: docs/untangle/<area>.md, docs/untangle/cross-area.md, and a
list of tickets.
```

**Mandatory case — the same prompt with no skill.** Record, verbatim, how it fails: files outside the area read, claims with no `file:line`, context blow-up.

**Optional case — `resume-picks-next`:** pre-seed `docs/untangle/<area>.md` with status `done`; the run should pick the next hotspot area and not re-read the finished one.

**Assertions** (objective, graded into `grading.json` as `{text, passed, evidence}`):

1. The decision log exists at `docs/untangle/<area>.md` and has at least one fix with a status.
2. Every problem item carries `file:line`, and every cited path exists with a line in range.
3. Every cited file is under the area or a direct import neighbour; all other links appear only in `cross-area.md`.
4. An independent reviewer opens every `file:line` and confirms the finding at the worked example's standard.
5. Source files are unchanged.
6. `tmp/untangle-evidence/` holds five non-empty map outputs.
7. The run's transcript shows no file outside the area plus neighbours was opened.

**Pass:** every assertion passes for `with_skill`, and at least assertions 1–3 fail in `without_skill`. The bar is: the map and decision log are finished without reading outside the area plus its import neighbours, and an independent reviewer confirms every `file:line`.

If the with-skill run fails, patch only the observed failure, write iteration 2, and re-run both arms. Do not rewrite from imagination.
