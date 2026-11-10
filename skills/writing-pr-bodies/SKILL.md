---
name: writing-pr-bodies
description: Use when a lane finishes a brief and must hand the coordinator the PR body — or when anyone writes or rewrites a PR description. Produces the two-part body our PRs use — plain English first, then the technical record with pasted evidence.
---

# Writing PR bodies

A PR body is read by three people who did not watch the work: the engineering lead, the reviewer
who merges, and the person who tells the client what shipped. Write for all three at once.
The shape is fixed; fill `pr-body-template.md` section by section and save it as
`PR-BODY-<issue>.md` next to the brief. The coordinator opens the PR with `--body-file`.

## The two parts, in this order

1. **`## What changes for the team`** — 3–6 sentences a fish-market operator's manager can read.
   What the operator sees differently, what stays exactly the same, what could go wrong and how
   we would notice. Name screens and fields by the app's own labels (`messages/ar.json`), never
   file names, never table names, never an acronym. Copy the brief's paragraph and correct it
   only where the code ended up different — say so if it did. Never head this section
   "In plain English".
2. **`## What changed in the code`** — one bullet per file or decision, each saying *why*, not
   just *what*. Name the seam (which existing function the new code plugs into), the one
   derivation for any money/holdings fact, and every decision the brief reserved and who made it.

Then, always:

- **`## Gate`** — every claim is a pasted command output: the RED run before the code, the GREEN
  run after, tsc exit code, eslint. Integration files you wrote but did not run say so:
  `written, not run — LANE-NEEDS-INTEGRATION-SLOT`. Never "passes locally", never "should".
- **`## Does NOT change`** — the invariants you were told not to touch, and confirm they were
  not (`git diff --stat origin/<base>` listing only in-scope files).
- **`## Ponytail review`** — what `/ponytail-review` named on your own diff and what you did
  with each line (fixed / kept, with the reason).
- **`## Deploy order`** — only when the PR carries a migration, a seed change, a repair script,
  or an env var. Numbered. Otherwise omit the heading.
- **`## Follow-ups`** — cases you saw and deliberately left out, one line each, so they become
  issues rather than surprises. Omit if none.

## Rules

- **The issue is referenced, never closed.** Feature PRs target `development`, so `Closes #N`
  never fires. Write `Part of #N` or `Slice C2 of #N`; the coordinator closes by hand at merge.
- **No numbers in the plain part.** Counts and test totals live in `## Gate`.
- **A caveat changes what the reader does or it is not a caveat.** If a screen is unchanged, say
  "no screen behaves differently for anyone today", not "may affect".
- **Arabic labels are quoted verbatim** from `messages/ar.json` («تاريخ الإرجاع»), never
  translated back to English in the plain part.
- **What you did not verify, you say you did not verify.** A body that claims a run that did not
  happen is a LANE-BLOCKED waiting to be found at the gate.
- Short beats complete. Ten lines that are all true beat forty that pad.

## Worked example (PR #2262, the ⋯ menu)

```markdown
## What changes for the team

On the sales journal, the two buttons on every sale row («تصحيح التاريخ» and «طباعة») now live
inside one three-dot menu at the end of the row. Nothing else changes yet. This frees the row for
the next step the client asked for: showing the notes and the return date on the same line.

## What changed in the code

- `src/components/admin/journal/journal-sale-groups.tsx`: the two `Button`s become
  `DropdownMenuItem`s under one `DropdownMenu` trigger. Gating for the date correction (cash
  sale, completed, `canCorrectCashSaleDate`) and the print spinner / disabled state are
  unchanged. Clicks stop propagation so the row does not toggle.
- `messages/en.json`, `messages/ar.json`: one key, `admin.journalPage.saleGroup.actionsAria`
  («إجراءات البيع»), for the trigger's aria-label.

## Gate (worktree on origin/development 401f73cf7)
- unit `src/components/admin/journal` + `src/lib/i18n`: 17 files, 393 passed
- tsc --noEmit: exit 0
- eslint on the touched component: clean

Slice C1 of #2261.
```

## Anti-patterns the gate rejects

| Written | Why it fails |
|---|---|
| `## Summary` with file paths first | The plain part is missing; the lead cannot read it |
| "Tests pass" | No pasted output; unverifiable |
| "Closes #2261" | Never fires on `development`; misleads the tracker |
| "Improved the journal" | Says nothing an operator can check on screen |
| A body longer than the diff | Padding; cut to what changes a reader's action |
