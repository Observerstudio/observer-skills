# Observer skills

Observer studio's agent skills, one folder per skill under `skills/`. They work with Claude Code, Codex, OpenCode and the other agents [skills.sh](https://www.skills.sh/) supports.

## Install

Pick one way per agent; installing both gives you every skill twice.

**Claude Code plugin (updates itself):**

```bash
claude plugin marketplace add Observerstudio/observer-skills
claude plugin install observer-skills@observer
```

**skills.sh (copies the files; update with `npx skills update`):**

```bash
npx skills add Observerstudio/observer-skills -g -y                            # every skill
npx skills add Observerstudio/observer-skills --skill promoting-a-release -g -y   # one skill
```

## Skills

| Skill | Use it to |
|---|---|
| [`coordinator`](skills/coordinator/SKILL.md) | Run a work track: diagnose, brief lanes, gate PRs and merge, while lanes do the implementation. Start at [`docs/onboarding.md`](skills/coordinator/docs/onboarding.md). |
| [`writing-lane-briefs`](skills/writing-lane-briefs/SKILL.md) | Write the brief a lane executes unattended: a plain-English part for the team, then the technical brief. |
| [`pr-review`](skills/pr-review/SKILL.md) | Self-review before a PR (author mode), or gate a PR to MERGE or CHANGES (gate mode). A repo adopts it with [`review-standards-template.md`](skills/pr-review/review-standards-template.md). |
| [`writing-pr-bodies`](skills/writing-pr-bodies/SKILL.md) | The PR body a lane hands back. Superseded by `pr` from mattpocock/skills; kept for briefs that still name it. |
| [`promoting-a-release`](skills/promoting-a-release/SKILL.md) | Promote a branch rung or ship a hotfix, rehearsing each step on a copy first so no work is lost. A repo adopts it with [`promotion-template.md`](skills/promoting-a-release/promotion-template.md). |
| [`untangle-codebase`](skills/untangle-codebase/SKILL.md) | Untangle a whole codebase in one pass so agents read less per change, break less without noticing, and debug faster. Typed by a person (`/untangle-codebase`). Claude Code never auto-invokes it (`disable-model-invocation`); other agents are told in the skill to stop and ask unless a person named it. |
| [`untangle-area`](skills/untangle-area/SKILL.md) | Untangle one area of a large codebase end to end (map, decision log, tickets, gate, production-copy proof and a lock) without loading the whole repo. Typed by a person (`/untangle-area`); Claude Code never auto-invokes it, other agents are told to stop and ask unless a person named it. |

The coordinator is used with [OCH — Observer Coordination Hub](https://github.com/Observerstudio/observer-coordination-hub), where claims, messages and knowledge live on a hub that feeds every session.

## Adding a skill

1. Create `skills/<name>/SKILL.md`. Its frontmatter `name` matches the folder, and a `description` names when to use it. Write it with `writing-for-agents`.
2. Add `./skills/<name>` to `.claude-plugin/plugin.json`, and add the skill to a grouping in `skills.sh.json`.
3. Check it: `npm install --no-save yaml && node scripts/check-skills.mjs`. CI runs the same check on every PR.

## Moved from `Observerstudio/coordinator`

This repo was `Observerstudio/coordinator`; the old name still redirects. If you installed from the old layout, reinstall once with a line above. Skills moved from the root into `skills/<name>/`, so an old install can't update itself.
