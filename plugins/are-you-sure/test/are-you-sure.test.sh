#!/bin/bash
# RED-first tests for the "Are you sure?" Stop hook. Run: bash plugins/are-you-sure/test/are-you-sure.test.sh
set -u
here=$(cd "$(dirname "$0")" && pwd)
hook="$here/../hooks/are-you-sure.sh"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
fails=0

pass() { printf 'ok   %s\n' "$1"; }
fail() { printf 'FAIL %s\n     %s\n' "$1" "$2"; fails=$((fails + 1)); }

if [ ! -f "$hook" ]; then
  echo "FAIL hook not found at $hook"
  exit 1
fi

transcript() { # $1 = path, $2 = assistant text
  jq -nc --arg t "$2" '{type:"user",message:{content:"go"}}' >"$1"
  jq -nc --arg t "$2" '{type:"assistant",message:{content:[{type:"text",text:$t}]}}' >>"$1"
}

long_claim=$(printf 'I recommend we drop the retry path. %.0s' {1..12})
[ ${#long_claim} -gt 400 ] || { echo "test fixture too short"; exit 1; }

# 1. stop_hook_active: true -> exit 0, no output
out=$(jq -nc '{stop_hook_active:true}' | "$hook" 2>&1); rc=$?
if [ $rc -eq 0 ] && [ -z "$out" ]; then pass "stop_hook_active skips"; else fail "stop_hook_active skips" "rc=$rc out=$out"; fi

# 2. long claim with "recommend", no "Checked:" -> block JSON
transcript "$tmp/t2.jsonl" "$long_claim"
out=$(jq -nc --arg t "$tmp/t2.jsonl" '{stop_hook_active:false,transcript_path:$t}' | "$hook" 2>&1); rc=$?
if [ $rc -eq 0 ] && jq -e '.decision=="block" and (.reason|length>0)' >/dev/null <<<"$out"; then
  pass "long claim blocks"
else
  fail "long claim blocks" "rc=$rc out=$out"
fi

# 3. same reply containing "Checked:" -> no output
transcript "$tmp/t3.jsonl" "$long_claim Checked: read the code · Assumed: nothing"
out=$(jq -nc --arg t "$tmp/t3.jsonl" '{stop_hook_active:false,transcript_path:$t}' | "$hook" 2>&1); rc=$?
if [ $rc -eq 0 ] && [ -z "$out" ]; then pass "Checked: skips"; else fail "Checked: skips" "rc=$rc out=$out"; fi

# 4. no jq on PATH -> exit 0, no output
bindir="$tmp/bin"
mkdir -p "$bindir"
for c in cat tail grep; do ln -s "$(command -v "$c")" "$bindir/$c"; done
transcript "$tmp/t4.jsonl" "$long_claim"
out=$(jq -nc --arg t "$tmp/t4.jsonl" '{stop_hook_active:false,transcript_path:$t}' | PATH="$bindir" /bin/bash "$hook" 2>&1); rc=$?
if [ $rc -eq 0 ] && [ -z "$out" ]; then pass "missing jq exits silently"; else fail "missing jq exits silently" "rc=$rc out=$out"; fi

echo
if [ $fails -eq 0 ]; then echo "GREEN"; else echo "RED ($fails failing)"; exit 1; fi
