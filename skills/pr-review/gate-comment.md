# The gate comment

Every gate posts one comment in this shape, MERGE or CHANGES. Keep the labels as written; the monthly report greps them.

The heading is one of: `## ✅ Gate: MERGE · <sha>`, `## ✅ Gate: MERGE · CI pending · <sha>` (any gating check still pending), `## ❌ Gate: CHANGES · <sha>`.

````markdown
## ✅ Gate: MERGE · `<sha>`

| Review | Reworks | Reviewer | Second reader |
|---|---|---|---|
| <passed>/<total> pass (N/A <n>) | <k> | <name> | <none\|1> |

### Findings
<open defects, most severe first; "None.">

- **[CRITICAL|HIGH|MEDIUM] `file:line` — <one-line defect>**
  Risk: <what goes wrong, with the failing input or scenario>
  Fix: <the concrete change>

### Nits
<taste, never blocking; "None.">

- **[LOW] `file:line` — <one line>** Fix: <change>


### Checks
- **Unit:** <what ran, the tail>
- **CI:** <the gating checks and their state; "pending — coordinator merges only when every gating check is green">
- **Standards touched:** <rule> ✅ · <rule> ❌→fixed in <sha>
- **Standards not touched:** <rules>
- **Reference used:** <none | book/paper + section, recorded in <ADR or brief>>
- **Deletes:** <what the PR removes, or "nothing, stated">

<details><summary>Attacks (<n>, <all held | k broke>)</summary>

- **<attack on a changed area>** → <outcome>

</details>
````

Severity: **CRITICAL** = money, holdings, custody, data loss, a security hole, or production down; **HIGH** = wrong
behaviour a user hits; **MEDIUM** = wrong in an edge case, or a missing test for a guard; **LOW** = taste, always a nit.
Any CRITICAL or HIGH is CHANGES. A MEDIUM is CHANGES unless the gap is stated and accepted here.

`Findings` and `Nits` stay apart: a finding blocks MERGE, a nit never does.

The `Standards touched` bullet makes the monthly "which standards caught what" report a grep. A
standard that never fires is either working or dead; the bullet tells you which.

## Metrics

`<total>` is the general checks plus the repo's extras. Record the score you actually gave, never a
rounded-up number. An N/A counts as passed for the score (`N/A <n>` says so); an accepted FAIL still
lowers the score, so accepted gaps stay visible after the merge.

Track over time: reworks per PR (target ≤1), FAILs caught before merge vs after (a post-merge FAIL
becomes a recorded lesson), and second-reader count (target: rare).
