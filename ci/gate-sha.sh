#!/bin/sh
# Prints the sha the jenkins/gate commit status belongs to: the revision Jenkins selected for this build.
#   - branch build (no CHANGE_ID): HEAD.
#   - pull request build: the PR head Jenkins pinned when it scheduled the build. Its checkout runs
#     `git checkout -f <pinned head>` and then, with the merge strategy, `git merge <pinned target>`. So HEAD is either
#     the pinned head itself (simple commit, a merge commit the branch pushed, or a target merge that was a no-op or a
#     fast-forward) or a synthetic merge on top of it whose first parent is the pinned head.
# The fetched ref refs/remotes/origin/PR-<id> is never consulted: it is mutable and names whatever the PR head was at
# fetch time, which is newer than the pinned head when the PR moved between scheduling and checkout. The checkout
# itself is the evidence. A commit is Jenkins' synthetic merge only when all three hold:
#   1. it has exactly two parents;
#   2. no remote-tracking ref contains it (origin has never seen it: it was made in this workspace);
#   3. its subject is the one git writes for a merge made on a detached HEAD ("Merge ... into HEAD"), which is how
#      Jenkins merges (`git merge <sha>` after `git checkout -f <sha>` gives "Merge commit '<sha>' into HEAD").
# A PR head that is itself a merge commit fails 2 (it was pushed, so origin/PR-<id> or a newer ref on top of it
# contains it) and, made on a branch, 3 as well; it is never replaced by its first parent.
# POSIX sh: the arm64 agents have no bash.
set -eu

head=$(git rev-parse HEAD)
[ -n "${CHANGE_ID:-}" ] || { echo "$head"; exit 0; }

# Unquoted on purpose: the words are HEAD followed by its parents.
set -- $(git rev-list --parents -n 1 HEAD)
[ "$#" -eq 3 ] || { echo "$head"; exit 0; }

if [ -n "$(git for-each-ref --count=1 --contains HEAD --format='%(refname)' refs/remotes)" ]; then
  echo "$head"; exit 0
fi

subject=$(git log -1 --format=%s HEAD)
case "$subject" in
  "Merge "*" into HEAD") git rev-parse HEAD^1 ;;
  *) echo "$head" ;;
esac
