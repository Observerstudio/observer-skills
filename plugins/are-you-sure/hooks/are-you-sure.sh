#!/bin/bash
# "Are you sure?" — before Claude ends a turn that makes claims or recommendations,
# stop it ONCE and make it check them. Skips short/status replies. Never loops.
# Opt-in plugin: if jq is missing, do nothing and never block the turn.
command -v jq >/dev/null 2>&1 || exit 0
input=$(cat)
[ "$(jq -r '.stop_hook_active // false' <<<"$input")" = "true" ] && exit 0
t=$(jq -r '.transcript_path // empty' <<<"$input")
[ -f "$t" ] || exit 0
# Text of the last assistant turn (all its text blocks since the last user message).
msg=$(tail -n 400 "$t" | jq -rs '
  (map(select(.type=="user" and ((.message.content|type)=="string" or any(.message.content[]?; .type=="text")))) | last) as $u
  | (index($u) // -1) as $i
  | .[($i+1):] | map(select(.type=="assistant") | .message.content[]? | select(.type=="text") | .text) | join("\n")' 2>/dev/null)
[ ${#msg} -lt 400 ] && exit 0
grep -qiE "recommend|root cause|the cause|because|fix option|I checked|verified|proven|should we|my rec|confirmed|is wrong|is right|works|safe to" <<<"$msg" || exit 0
grep -q "Checked:" <<<"$msg" && exit 0
reason='Are you sure? Before you send this, check it once:
1. Each claim: did you read it yourself (file:line, command output, query) or infer it? Mark which.
2. Does any recommendation reverse an earlier decision, ticket, ADR or memory? Search for one first (gh issue/PR search, memory, code comments).
3. Name the one fact that would make this answer wrong, and check it now if you can.
Then rewrite the reply with what changed, and end it with one line: "Checked: … · Assumed: …".'
jq -n --arg r "$reason" '{decision:"block", reason:$r}'
