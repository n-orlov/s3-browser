#!/bin/sh
# Prints the sha the jenkins/gate commit status belongs to: the revision Jenkins selected for this build.
#   - branch build (no CHANGE_ID): HEAD.
#   - pull request build: the PR head. Jenkins fetches it as refs/remotes/origin/PR-<CHANGE_ID> and checks out either
#     that commit itself (the target merge was a fast-forward or a no-op) or a synthetic merge commit whose first
#     parent is the PR head and whose second parent is the target. The PR head may itself be a merge commit (a
#     branch that merged the target), so the shape of HEAD alone never tells the two apart: the fetched ref does.
# POSIX sh: the arm64 agents have no bash.
set -eu

[ -n "${CHANGE_ID:-}" ] || { git rev-parse HEAD; exit 0; }

ref="refs/remotes/origin/PR-$CHANGE_ID"
pr=$(git rev-parse -q --verify "$ref^{commit}" 2>/dev/null || true)
if [ -z "$pr" ]; then
  git fetch --quiet origin "+refs/pull/$CHANGE_ID/head:$ref" >/dev/null 2>&1 || true
  pr=$(git rev-parse -q --verify "$ref^{commit}" 2>/dev/null || true)
fi

head=$(git rev-parse HEAD)
first=$(git rev-parse -q --verify HEAD^1 2>/dev/null || true)
second=$(git rev-parse -q --verify HEAD^2 2>/dev/null || true)

if [ -n "$pr" ]; then
  # The ref names the PR head; trust it only when this checkout is that commit or a merge on top of it.
  if [ "$pr" = "$head" ]; then echo "$head"; exit 0; fi
  if [ -n "$second" ] && [ "$pr" = "$first" ]; then echo "$first"; exit 0; fi
  echo "gate-sha: HEAD $head is neither the PR head $pr nor a merge on top of it" >&2
  exit 1
fi

# No PR head ref and no way to fetch it. A merge whose second parent is the target tip is Jenkins' synthetic merge
# (first parent = PR head); anything else is the PR head itself.
if [ -n "$second" ] && [ -n "${CHANGE_TARGET:-}" ]; then
  tip=$(git rev-parse -q --verify "refs/remotes/origin/$CHANGE_TARGET^{commit}" 2>/dev/null || true)
  if [ -n "$tip" ] && [ "$tip" = "$second" ]; then echo "$first"; exit 0; fi
fi
echo "$head"
