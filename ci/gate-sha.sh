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
# HEAD or not, published or since force-pushed away. The evidence is what git recorded in HEAD's reflog while this
# build made the checkout, and only this build's part of it: the Jenkinsfile starts every gated checkout with
# beginCheckout, which empties the workspace's HEAD reflog and records in .git/gate-sha-boundary the commit HEAD stood
# on at that moment. Earlier builds' merges and fast-forwards are therefore gone, and git writes no entry for a
# checkout that does not move HEAD, so an empty log means "this build's checkout left HEAD where it was": the pinned
# head is HEAD itself, even when HEAD is the merge or the target tip an earlier build produced. Otherwise, the log is
# this build's own and, newest first, skipping entries that did not move HEAD (the final re-checkout), the first entry
# that moved HEAD is:
#   - `merge ...` (the target merge, a new merge commit or a fast-forward) ending at HEAD: the selected head is the
#     commit HEAD stood on before it, i.e. the pinned head the checkout put there;
#   - anything else ending at HEAD (`checkout: moving from ... to <pinned head>`): HEAD is the selected head.
# The script fails rather than post a status on a guessed sha when the boundary is missing, when the log does not
# start at the boundary (the history was not reset for this build) or when HEAD moved without a record.
# POSIX sh and awk: the arm64 agents run BusyBox and have no bash.
set -eu

head=$(git rev-parse HEAD)
[ -n "${CHANGE_ID:-}" ] || { echo "$head"; exit 0; }

boundary_file=$(git rev-parse --git-path gate-sha-boundary)
[ -s "$boundary_file" ] || { echo "gate-sha: no checkout boundary ($boundary_file); the checkout did not start with beginCheckout, so earlier builds' history cannot be told from this build's" >&2; exit 1; }
boundary=$(cat "$boundary_file")

log=$(git rev-parse --git-path logs/HEAD)
[ -f "$log" ] || log=/dev/null

# Each line: "<old> <new> <ident> <time> <tz>\t<message>".
awk -v head="$head" -v boundary="$boundary" '
  function fail(why) { print "gate-sha: " why "; cannot tell which PR head Jenkins selected" > "/dev/stderr"; exit 1 }
  {
    tab = index($0, "\t")
    split(substr($0, 1, tab - 1), f, " ")
    old[NR] = f[1]; new[NR] = f[2]; msg[NR] = substr($0, tab + 1)
  }
  END {
    if (NR == 0) {
      if (head != boundary) fail("HEAD moved from " boundary " to " head " without a reflog record")
      print head; exit 0
    }
    if (old[1] != boundary) fail("the HEAD reflog does not start at the boundary " boundary)
    if (new[NR] != head) fail("the HEAD reflog does not record how HEAD reached " head)
    for (i = NR; i > 0; i--) {
      if (old[i] == new[i]) continue
      if (new[i] != head) fail("the HEAD reflog does not record how HEAD reached " head)
      if (msg[i] ~ /^merge /) print old[i]; else print head
      exit 0
    }
    print head
  }
' "$log"
