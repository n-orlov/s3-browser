#!/bin/sh
# Prints the sha the jenkins/gate commit status belongs to: the revision Jenkins selected for this build.
#   - branch build (no CHANGE_ID): HEAD.
#   - pull request build: the PR head Jenkins pinned when it scheduled the build. Its checkout runs
#     `git checkout -f <pinned head>`, then, with the merge strategy, `git merge <pinned target>`, then
#     `git checkout -f <result>`. So HEAD is the pinned head itself (a simple commit or any merge commit the PR
#     carries, when the target merge was a no-op), or a commit the target merge produced from it: a synthetic merge,
#     or the target tip after a fast-forward.
# Neither the fetched ref refs/remotes/origin/PR-<id> (mutable: it names whatever the head was at fetch time) nor the
# shape or subject of the commit is evidence: a PR head can be a merge commit with any subject, made on a detached
# HEAD or not, published or since force-pushed away. The evidence is what git recorded in this workspace's HEAD
# reflog while it built the checkout. Walking it newest first and skipping entries that did not move HEAD (the final
# re-checkout of the result), the first entry that moved HEAD is:
#   - `merge ...` (the target merge, a new merge commit or a fast-forward) ending at HEAD: the selected head is the
#     commit HEAD stood on before it, i.e. the pinned head the checkout put there;
#   - anything else ending at HEAD (`checkout: moving from ... to <pinned head>`): HEAD is the selected head;
#   - an entry not ending at HEAD, or no reflog at all: HEAD moved without a record, so the selected head is unknown
#     and the script fails rather than post a status on a guessed sha.
# POSIX sh and awk: the arm64 agents run BusyBox and have no bash.
set -eu

head=$(git rev-parse HEAD)
[ -n "${CHANGE_ID:-}" ] || { echo "$head"; exit 0; }

log=$(git rev-parse --git-path logs/HEAD)
[ -s "$log" ] || { echo "gate-sha: no HEAD reflog in this checkout ($log); cannot tell which PR head Jenkins selected" >&2; exit 1; }

# Each line: "<old> <new> <ident> <time> <tz>\t<message>".
awk -v head="$head" '
  {
    tab = index($0, "\t")
    split(substr($0, 1, tab - 1), f, " ")
    old[NR] = f[1]; new[NR] = f[2]; msg[NR] = substr($0, tab + 1)
  }
  END {
    for (i = NR; i > 0; i--) {
      if (old[i] == new[i]) continue
      if (new[i] != head) break
      if (msg[i] ~ /^merge /) print old[i]; else print head
      exit 0
    }
    print "gate-sha: the HEAD reflog does not record how HEAD reached " head "; cannot tell which PR head Jenkins selected" > "/dev/stderr"
    exit 1
  }
' "$log"
