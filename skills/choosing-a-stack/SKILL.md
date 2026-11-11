---
name: choosing-a-stack
description: Use when a new project starts and its stack is not yet chosen — interviews the developer or lead in rounds and writes docs/adr/0001-stack.md from Observer's approved menu. Not for changing an existing project's stack.
---

# choosing-a-stack

A new project's stack is chosen once, in one interview, from one approved menu, and written down before any code exists. The **lead decides**; you recommend. You recommend only from the menu in `observer-sdlc/docs/stacks.md`, read fresh every run, so projects stay alike and what one project learns carries to the next.

The session ends at a stack decision written as the new repo's first ADR: `docs/adr/0001-stack.md`. It does not create the repo, a starter, CI, or rule config.

Two habits carry the whole skill: **facts are your job** (look them up; the lead is asked only for decisions) and **rounds** (ask everything you can answer now, never a question whose prerequisite is still open).

## 1. Read the menu

Read it every run, before the first question.

1. `../observer-sdlc/docs/stacks.md` if the folder exists beside this one; otherwise
2. `gh api repos/Observerstudio/observer-sdlc/contents/docs/stacks.md --jq .content | base64 -d`.
3. If neither works, **stop**. Say you cannot read the approved menu and therefore cannot recommend a stack. Never fall back on remembered stacks, and never invent a combination.

Done when you have read all four sections by name: `## Shared baseline`, `## Stacks by project shape`, `## Choosing rules`, `## Changing the menu`. Those headings are the only part of the menu you may carry in your head; the stacks themselves come from the file each time.

The menu is the source of every recommendation in this session. Changing the menu is how the menu changes; an in-interview exception is an override the lead owns (step 5), not a new menu.

## 2. Look facts up before you ask

Do this before round 1 and again whenever a round needs it. Ask the lead nothing you can find yourself:

- **The project itself:** the brief, ticket or issue, if one is linked or present in the folder.
- **The client's world:** existing repos, hosting or tech limits, if a client or repo is named.
- **Versions:** the current stable version of every candidate the menu might pick — `npm view <pkg> version` (one call per package). These become the ADR's pinned versions, so they must be read now, not remembered.

Done when every candidate you are about to recommend or mention has a version you looked up in this session, and every environment fact you can reach is in hand. A question to the lead that a command could answer is a defect in this session.

Also note now whether `docs/adr/0001-stack.md` already exists in this folder (step 6 uses it).

## 3. Run rounds

The choices form a tree. The **frontier** is every question whose prerequisites are settled: the ones you can ask now without guessing at an answer. Ask the whole frontier in one round, numbered, each with your recommended answer, and each worded so a plain "yes" accepts the recommendation. Then wait.

Format every round exactly like this:

```
❓ **Q1** - **<question title>**: <question body, may be several paragraphs or list choices>

➡️ <your recommended answer>

---

❓ **Q2** - **<question title>**: <question body>

➡️ <your recommended answer>
```

- **A question whose answer depends on another question still open waits for a later round.** Asking it now is guessing.
- **Early answers are settled.** When the lead answers several questions in one line, or answers a later-round question ahead of time, record it as settled, build on it, and never ask it again.
- **Recommendations come only from the menu.** Name the rule in `## Choosing rules` that produced the recommendation, so the lead can argue with the reason, not just the answer.
- **Plain English.** A short sentence per question, no jargon the lead would have to look up.

Done when the round is posted and you are waiting. Do not answer the round for the lead.

## 4. Round 1 — ask these, in this order

Ask the whole list; skip only one the lead already answered in the opening message.

1. **Which parts exist** — product web app, landing or marketing site, admin, API for others, mobile app. Any combination.
2. **What it is and who uses it** — the kind of product, described in plain words.
3. **Does Google need to find it** — public pages that must rank, or nothing public.
4. **Do non-developers edit the content** — marketers, editors, a content team.
5. **Is all of it behind a login** — or is some of it public.
6. **Who calls the backend** — only your own web app, or others now or likely later (mobile, partners, vendors).
7. **Is it heavy on money and reporting** — running balances, statements, reports, heavy queries.
8. **Team size and size of the domain** — how many developers, how big and tangled the business rules.
9. **Client limits on hosting or tech** — anything imposed from outside, which is recorded as a constraint, not chosen here.

For each, the ➡️ line is the menu's answer for the shape the lead has described so far.

## 5. Later rounds — branch from the answers

Ask only the branches the answers opened, still a whole frontier per round:

- **Public part:** Astro or Next.js, plus Sanity when non-developers edit content.
- **API layer:** tRPC, Hono with OpenAPI, or NestJS.
- **Database layer:** Drizzle or Prisma.
- **Mobile:** Expo yes or no.
- **Auth:** the menu's default for a stack with its own users, unless the lead says otherwise.
- **One repo or several:** only when there is more than one part.
- **Per part:** the parts share one interview and one ADR, one section per part.

Take the rule that decides each of these from `## Choosing rules` at the moment you ask, and say which rule it was.

**Overrides.** The lead's choice always wins. When it is off the menu, or against your recommendation, record it as an override: ask for the reason if the lead did not give one ("what's the reason? I'll write it in the ADR"), and write the choice with the lead's reason in the ADR. An override without a reason is an unfinished round.

Done when the frontier is empty: every branch visited, nothing silently assumed, every override carrying the lead's reason.

## 6. Confirm, then write

1. **Summarise the decision on one screen** — one line per layer per part: the choice and the one-line reason. Ask the lead to confirm it.
2. **Write nothing before that confirmation.** No draft ADR, no folder, no file.
3. **Write `docs/adr/0001-stack.md`** under the folder the skill was run in, from [`adr-template.md`](adr-template.md): the stack per layer, the answers that led to each choice, the options considered and rejected with one line each, the lead's overrides with the lead's reason, the versions you looked up, and any open questions.
4. **An ADR already there:** do not overwrite it. Say it exists, ask whether to write anyway, and offer the next free number (`docs/adr/0002-stack.md`, and so on) as the recommended answer.
5. **Say where it was written.** If there is no repo yet, say so plainly: the file is at `docs/adr/0001-stack.md` under this folder, and the lead moves it into the repo when the repo exists.

Done when the file exists at the agreed path, the lead knows its path, and the ADR's six sections are filled. Then stop. Creating the repo, a starter, CI or config belongs to the next step in the process, not to this skill.

## Rules that hold for the whole session

- **The lead decides; you recommend.** Never present a recommendation as a decision already made.
- **Never name a client** in the menu, in this skill, or in any shared repo; examples describe the kind of project ("a money and reporting web app"). The ADR lives in the client's own repo and may name them there.
- **Plain English** in questions and in the ADR.
- **No remembered stacks.** If the menu cannot be read, the session stops.
