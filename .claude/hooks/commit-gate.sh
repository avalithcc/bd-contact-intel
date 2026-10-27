#!/usr/bin/env bash
# PreToolUse(Bash) gate: before a `git commit`, run lint + the unit suite in the
# checkout that is about to be committed, and block (exit 2) when either fails.
#
# Scope: this protects commits made by Claude Code only. A commit made from a
# terminal, an IDE or a plain git hook is not seen by it.
#
# Claude Code feeds the tool call as JSON on stdin: {"cwd": ..., "tool_input": {"command": ...}}.
# The checkout under test is the git toplevel of that cwd, not CLAUDE_PROJECT_DIR:
# in a worktree session the project dir can be the main checkout, which would
# gate the wrong files.
set -u

input=$(cat)
# Cheap pre-filter on the raw payload with a bash regex, so the common path
# (every non-commit Bash call) needs no external tool.
[[ $input =~ git[^|\;\&]*commit ]] || exit 0

# Below this line the call looks like a commit: fail closed, loudly, if a
# dependency is missing instead of silently not gating.
for tool in jq rg; do
  command -v "$tool" >/dev/null || {
    echo "commit gate: '$tool' is not installed, so the commit cannot be checked - blocked" >&2
    exit 2
  }
done

cmd=$(jq -r '.tool_input.command // empty' <<<"$input")
printf '%s' "$cmd" | rg -q '\bgit\b([^|;&]*\s)?commit\b' || exit 0

cwd=$(jq -r '.cwd // empty' <<<"$input")
dir="${cwd:-${CLAUDE_PROJECT_DIR:-$PWD}}"
root=$(git -C "$dir" rev-parse --show-toplevel 2>/dev/null) || {
  echo "commit gate: $dir is not inside a git checkout" >&2
  exit 2
}
cd "$root" || exit 2
test -f package.json || { echo "commit gate: $root has no package.json" >&2; exit 2; }
# Only ever run this project's scripts. A commit in some other repo the
# session cd'd into is not ours to gate, and running its npm scripts here
# would execute that repo's code without a permission prompt.
[[ $(jq -r '.name // empty' package.json) == "bd-contact-intel" ]] || exit 0
test -d node_modules || { echo "commit gate: run npm ci in $root first (no node_modules)" >&2; exit 2; }

run() {
  local name=$1 out
  shift
  if ! out=$("$@" 2>&1); then
    echo "$name FAILED in $root - commit blocked. Last output:" >&2
    printf '%s\n' "$out" | tail -n 40 >&2
    exit 2
  fi
}

run lint npm run lint
run test:unit npm run test:unit
echo "lint + unit OK in $root"
