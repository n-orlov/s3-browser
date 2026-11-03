#!/bin/sh
# Prints the sha the jenkins/gate commit status belongs to: the revision Jenkins selected for this build.
#   - branch build (no CHANGE_ID): HEAD.
#   - pull request build: the PR head Jenkins pinned when it scheduled the build, which the Jenkinsfile hands over in
#     GATE_PINNED_HEAD (the revision of the build's own SCM, `scm.branches[0].name`). It is a fact of this build, so
#     the answer does not depend on what earlier builds left in this workspace. Jenkins' checkout runs
#     `git checkout -f <pinned head>`, then, with the merge strategy, `git merge <pinned target>`, then
#     `git checkout -f <result>`; so HEAD is the pinned head itself (a simple commit or any merge commit the PR
#     carries, when the target merge was a no-op), or a commit the target merge produced from it: a synthetic merge,
#     or the target tip after a fast-forward. In every case the pinned head is HEAD or an ancestor of it.
# Neither the fetched ref refs/remotes/origin/PR-<id> (mutable: it names whatever the head was at fetch time), nor the
# shape or subject of HEAD, nor the HEAD reflog is evidence: the reflog of a reused workspace holds the merges and
# fast-forwards of earlier builds, and git writes no entry at all for a checkout that does not move HEAD, so it cannot
# tell this build's selection from an earlier one's when both end at the same commit.
# The pin is verified against the checkout, never trusted blindly: it must be a full object id naming a commit that
# is HEAD or an ancestor of HEAD, otherwise the script fails rather than post a status on a sha the build did not build.
# POSIX sh: the arm64 agents run BusyBox and have no bash.
set -eu

head=$(git rev-parse HEAD)
[ -n "${CHANGE_ID:-}" ] || { echo "$head"; exit 0; }

pin=${GATE_PINNED_HEAD:-}
[ -n "$pin" ] || { echo "gate-sha: GATE_PINNED_HEAD is not set; cannot tell which PR head Jenkins selected" >&2; exit 1; }
case "$pin" in
  *[!0-9a-f]*) pin_ok= ;;
  *) case ${#pin} in 40|64) pin_ok=1 ;; *) pin_ok= ;; esac ;;
esac
[ -n "$pin_ok" ] || { echo "gate-sha: GATE_PINNED_HEAD is not a full commit id: $pin" >&2; exit 1; }

pinned=$(git rev-parse --verify -q "$pin^{commit}") || { echo "gate-sha: the pinned head $pin is not a commit in this checkout" >&2; exit 1; }
[ "$pinned" = "$pin" ] || { echo "gate-sha: GATE_PINNED_HEAD $pin does not name a commit" >&2; exit 1; }
if [ "$pinned" != "$head" ] && ! git merge-base --is-ancestor "$pinned" "$head"; then
  echo "gate-sha: the pinned head $pinned is not HEAD or an ancestor of HEAD ($head); the checkout is not this build's" >&2
  exit 1
fi
echo "$pinned"
