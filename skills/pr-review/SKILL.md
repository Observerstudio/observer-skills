---
name: pr-review
description: "Use before opening a PR (author mode: self-review so cheap misses never reach a reviewer) and when reviewing or gating a PR (gate mode: devil's-advocate pass ending in MERGE or CHANGES and a gate comment). Works in every Observer repo."
---

# pr-review

Two modes, one set of checks. Read the repo's `docs/agents/review-standards.md` first in both. A
missing file is stated out loud ("no review-standards file; general checks only") and the run
continues on [`pr-review/general-checks.md`](general-checks.md). A repo adopts the skill by copying
[`templates/review-standards.md`](../templates/review-standards.md).

Invoke the named skills; never copy their steps here.

## author

Run before the PR opens. Done when the PR body carries the self-review, stamped with the head SHA, and CI is green.

1. Read the repo file (or state it is missing).
2. Run `code-review` (Standards + Spec).
3. Run `ponytail-review`.
4. `tdd`: every new guard has a test that goes red when the guard is removed; paste the red. Then probe each guard: one test per input it should refuse (same id, wrong owner, wrong type, wrong season/book, …), paste that each is refused. A probe that resolves is a finding.
5. `superpowers:verification-before-completion`: every claim is pasted output. Run the repo file's `## Commands` (type check, lint, unit tests) on the touched files and paste the results; a repo file with no `## Commands` is stated, and the repo's own scripts stand in.
6. Fix the findings with `superpowers:receiving-code-review`. Verify each finding against the code first; a wrong finding gets an answer with evidence, not a fix.
7. Write the self-review into the PR body with `pr` (`writing-pr-bodies` when `pr` is not installed), stamped with the head SHA.
8. After the PR is open, run `claude-mem:babysit` until CI is green and the PR is mergeable. The author fixes; the gate never does.

## gate <PR>

Done when the gate comment is posted with a verdict of MERGE or CHANGES and an Attacks block (`<details>`, summary `Attacks (<n>, …)`) with at least one attack per changed area, each naming the strongest attack tried and its outcome; a MERGE with no attacks is invalid. Round 1 (`reworks=0`) lists at least one finding or nit, or states in writing why there is nothing to find.

1. Pin the head SHA in a read-only worktree.
2. Start the touched tests in the background and read `gh pr checks <n>` once; never block on `--watch`.
3. Run `code-review` (Standards + Spec) and `ponytail-review` on the diff, then read it as devil's advocate: assume a defect exists. A PR-body claim (tests pass, no other callers, counts) counts only once you re-check it; unchecked, it is a finding. Score it against [`general-checks.md`](general-checks.md) plus the repo file's checks. A type-check or lint failure in `gh pr checks` is a finding.
4. Run your own mutation per new guard, even when the PR pastes one. A PR whose tests were written after the code (no red run) gets this step in full.
5. Verdict on the code, without waiting for CI. Gating is the repo file's `## Gating checks`; with no such file or section, it is the required checks from `gh api repos/<owner>/<repo>/branches/<base>/protection`, and a verdict with none says so. A skipped check counts as passed.
   - A gating check already red: CHANGES (a failure is a finding).
   - Checks still pending: the verdict stands on the code, and the CI bullet says `pending — coordinator merges only when every gating check is green`.
   - No finding open: MERGE. The coordinator executes it only once every gating check is green; never on pending checks.
6. Post the comment in the shape of [`gate-comment.md`](gate-comment.md).

Reviewer count and the second-reader rule: [`docs/coordinator-playbook.md`](../docs/coordinator-playbook.md) "The gate". Extras (`security-review`, `database-review`, the `pr-review-toolkit` agents) run only when the repo file names that kind of change; a FAIL from one is a finding.
