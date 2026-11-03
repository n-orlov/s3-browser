#!/usr/bin/env bash
# Pre-publish half of the release flow (Jenkinsfile.release runs it inside withCredentials, GH_TOKEN set).
#
#   1. guards, all before anything is created on GitHub: VERSION is vMAJOR.MINOR.PATCH[-pre], package.json
#      carries the same version, the tag and any release for it do not exist, immutable releases are on
#   2. create the DRAFT release by REST (a draft has no tag to look it up by, so its numeric id is kept)
#   3. upload the Linux and Windows assets and sbom.cdx.json to the draft by id
#   4. dispatch .github/workflows/macos-build.yml with return_run_details=true, correlate the run
#      (run-name carries the correlation id) and wait for it with a deadline
#
# A trap deletes the draft when any step fails before the release is published. The draft id is printed
# on stdout as "draft-id=<id>" when the macOS leg has succeeded.
#
# Environment:
#   REPO          owner/name of the repository (required)
#   VERSION       release tag, e.g. v0.20.0 (required)
#   RELEASE_SHA   full commit sha the release is cut from (required)
#   DIST          directory holding the electron-builder output (required): *.AppImage and *.exe are uploaded
#   SBOM          the CycloneDX file to upload (default: $DIST/sbom.cdx.json)
#   SOURCE_DIR    checkout whose package.json is compared with VERSION (default: the current directory)
#   GH_TOKEN      GitHub token (required)
#   DISPATCH_REF  branch whose macos-build.yml runs (default: master)
#   MAC_TIMEOUT_MIN  minutes to wait for the macOS run before cancelling it (default 45)
#   POLL_SECONDS / RETRY_SECONDS  wait between status polls (default 15) / between lookups (default 5)
#   GITHUB_API / GITHUB_UPLOADS   API roots (default https://api.github.com / https://uploads.github.com)
set -euo pipefail
export GIT_TERMINAL_PROMPT=0

API_VERSION=2026-03-10   # the default 2022-11-28 answers with a Deprecation header
GITHUB_API="${GITHUB_API:-https://api.github.com}"
GITHUB_UPLOADS="${GITHUB_UPLOADS:-https://uploads.github.com}"

log() { printf '%s %s\n' "$(date -u +%H:%M:%S)" "$*" >&2; }
die() { echo "$*" >&2; exit 1; }

: "${REPO:?}" "${VERSION:?}" "${RELEASE_SHA:?}" "${DIST:?}" "${GH_TOKEN:?}"
SBOM="${SBOM:-$DIST/sbom.cdx.json}"
SOURCE_DIR="${SOURCE_DIR:-.}"
DISPATCH_REF="${DISPATCH_REF:-master}"
MAC_TIMEOUT_MIN="${MAC_TIMEOUT_MIN:-45}"
POLL_SECONDS="${POLL_SECONDS:-15}"
RETRY_SECONDS="${RETRY_SECONDS:-5}"

# One GitHub REST call: api METHOD PATH [JSON-BODY]; the body of the answer goes to stdout, a non-2xx fails.
api() {
  local method=$1 path=$2 body=${3-}
  curl -fsS -X "$method" \
    -H "Authorization: Bearer $GH_TOKEN" \
    -H "Accept: application/vnd.github+json" \
    -H "X-GitHub-Api-Version: $API_VERSION" \
    ${body:+-H "Content-Type: application/json" -d "$body"} \
    "$GITHUB_API/$path"
}

# pyget EXPR < json: print EXPR evaluated with `d` = the parsed document and `a` = the extra arguments.
pyget() {
  local expr=$1
  shift
  python3 -c '
import json, sys
d = json.load(sys.stdin)
a = sys.argv[2:]
v = eval(sys.argv[1])
print("true" if v is True else "false" if v is False else "" if v is None else v)
' "$expr" "$@"
}

# --- 1. guards: nothing exists on GitHub yet
[[ "$VERSION" =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]] || die "VERSION $VERSION is not vMAJOR.MINOR.PATCH[-pre]"
[[ "$RELEASE_SHA" =~ ^[0-9a-f]{40}$ ]] || die "RELEASE_SHA is not a full sha"
[[ "$REPO" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || die "REPO $REPO is not owner/name"
[[ "$MAC_TIMEOUT_MIN" =~ ^[0-9]+$ ]] || die "MAC_TIMEOUT_MIN $MAC_TIMEOUT_MIN is not a number"

pkg_version=$(pyget 'd["version"]' < "$SOURCE_DIR/package.json")
[ "$pkg_version" = "${VERSION#v}" ] || die "package.json version $pkg_version differs from ${VERSION#v}"

assets=()
for f in "$DIST"/*.AppImage "$DIST"/*.exe "$SBOM"; do
  [ -f "$f" ] && assets+=("$f")
done
{ ls "$DIST"/*.AppImage "$DIST"/*.exe >/dev/null 2>&1 && [ -f "$SBOM" ]; } ||
  die "$DIST needs at least one .AppImage and one .exe, and $SBOM must exist"

refs=$(api GET "repos/$REPO/git/matching-refs/tags/$VERSION")
[ "$(pyget 'any(r["ref"] == a[0] for r in d)' "refs/tags/$VERSION" <<<"$refs")" = false ] ||
  die "tag $VERSION already exists"
releases=$(api GET "repos/$REPO/releases?per_page=100")
[ "$(pyget 'sum(1 for r in d if r.get("tag_name") == a[0])' "$VERSION" <<<"$releases")" = 0 ] ||
  die "a release or draft already carries $VERSION; delete it first"
[ "$(api GET "repos/$REPO/immutable-releases" | pyget 'd.get("enabled")')" = true ] ||
  die "immutable releases are off"

# --- 2. the draft, by REST, keeping its numeric id
case "$VERSION" in *-*) prerelease=true ;; *) prerelease=false ;; esac
RELEASE_ID=$(api POST "repos/$REPO/releases" \
  "{\"tag_name\":\"$VERSION\",\"target_commitish\":\"$RELEASE_SHA\",\"name\":\"$VERSION\",\"draft\":true,\"prerelease\":$prerelease,\"generate_release_notes\":true}" |
  pyget 'd["id"]')
[[ "$RELEASE_ID" =~ ^[0-9]+$ ]] || die "no draft id (got: $RELEASE_ID)"
log "draft $RELEASE_ID created for $VERSION at $RELEASE_SHA"

published=false
on_exit() {
  local rc=$?
  trap - EXIT
  if [ "$rc" != 0 ] && [ "$published" = false ]; then
    if api DELETE "repos/$REPO/releases/$RELEASE_ID" >/dev/null; then
      log "FAILED: draft $RELEASE_ID deleted"
    else
      log "FAILED: draft $RELEASE_ID could NOT be deleted; delete it by hand"
    fi
  fi
  exit "$rc"
}
trap on_exit EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# --- 3. uploads by release id (electron-builder names contain spaces; GitHub turns them into dots)
for f in "${assets[@]}"; do
  name=$(basename "$f")
  curl -fsS -o /dev/null -X POST \
    -H "Authorization: Bearer $GH_TOKEN" \
    -H "Accept: application/vnd.github+json" \
    -H "X-GitHub-Api-Version: $API_VERSION" \
    -H "Content-Type: application/octet-stream" \
    --data-binary "@$f" \
    "$GITHUB_UPLOADS/repos/$REPO/releases/$RELEASE_ID/assets?name=${name// /%20}"
  log "uploaded $name"
done

# --- 4. dispatch the macOS build; return_run_details=true makes the API answer with the run id
CORR="jenkins-$(printf '%s' "${BUILD_TAG:-local}" | tr -c 'A-Za-z0-9' '-')-$(date +%s)-$RANDOM"
RUN_ID=$(api POST "repos/$REPO/actions/workflows/macos-build.yml/dispatches" \
  "{\"ref\":\"$DISPATCH_REF\",\"return_run_details\":true,\"inputs\":{\"tag\":\"$VERSION\",\"sha\":\"$RELEASE_SHA\",\"release_id\":\"$RELEASE_ID\",\"correlation_id\":\"$CORR\"}}" |
  pyget 'd.get("workflow_run_id")') || RUN_ID=
if ! [[ "$RUN_ID" =~ ^[0-9]+$ ]]; then # fallback: find our run by the run-name marker
  RUN_ID=
  for _ in $(seq 1 24); do
    RUN_ID=$(api GET "repos/$REPO/actions/workflows/macos-build.yml/runs?event=workflow_dispatch&per_page=20" |
      pyget 'next((r["id"] for r in d["workflow_runs"] if "[" + a[0] + "]" in (r.get("display_title") or "")), "")' "$CORR") || RUN_ID=
    [ -n "$RUN_ID" ] && break
    sleep "$RETRY_SECONDS"
  done
fi
[[ "$RUN_ID" =~ ^[0-9]+$ ]] || die "could not identify the dispatched macOS run"

# run-name is rendered a few seconds after the run exists (until then display_title is the bare workflow
# name), so poll before treating a mismatch as "not our run"
title=
for _ in $(seq 1 12); do
  title=$(api GET "repos/$REPO/actions/runs/$RUN_ID" | pyget 'd.get("display_title")') || title=
  [[ "$title" == *"[$CORR]"* ]] && break
  sleep "$RETRY_SECONDS"
done
[[ "$title" == *"[$CORR]"* ]] || die "run $RUN_ID is [$title], not ours ($CORR)"
log "macOS run $RUN_ID: https://github.com/$REPO/actions/runs/$RUN_ID"

# --- wait for it, with a deadline; GitHub ends a run that never got a runner after ~15 min as a failure
deadline=$(($(date +%s) + MAC_TIMEOUT_MIN * 60))
while :; do
  state=$(api GET "repos/$REPO/actions/runs/$RUN_ID" | pyget 'd["status"] + "|" + (d.get("conclusion") or "")')
  [ "${state%%|*}" = completed ] && break
  if [ "$(date +%s)" -ge "$deadline" ]; then
    api POST "repos/$REPO/actions/runs/$RUN_ID/cancel" >/dev/null || true
    die "macOS run $RUN_ID still ${state%%|*} after ${MAC_TIMEOUT_MIN} min; cancelled"
  fi
  sleep "$POLL_SECONDS"
done
[ "${state#*|}" = success ] || die "macOS run $RUN_ID concluded ${state#*|}; not publishing"
log "macOS run $RUN_ID succeeded"

echo "draft-id=$RELEASE_ID"
