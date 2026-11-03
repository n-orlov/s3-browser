#!/usr/bin/env bash
# The GitHub half of the release flow. Jenkinsfile.release runs it stage by stage inside withCredentials
# (GH_TOKEN set); with no argument it runs every phase in one process.
#
#   usage: ci/release-stage.sh [all|check|draft|macos|verify|publish|cleanup]
#
#   check    (stage Version check)  guards, all before anything is created on GitHub: VERSION is
#            vMAJOR.MINOR.PATCH[-pre], package.json carries the same version, the tag and any release for it
#            do not exist, immutable releases are on
#   draft    (stage Draft)          create the DRAFT release by REST (a draft has no tag to look it up by, so
#            its numeric id is kept), upload the Linux and Windows assets and sbom.cdx.json to it by id
#   macos    (stage macOS)          dispatch .github/workflows/macos-build.yml with return_run_details=true,
#            correlate the run (run-name carries the correlation id) and wait for it with a deadline
#   verify   (stage Verify)         the draft holds exactly the expected asset set (GitHub's dotted names), each
#            in state "uploaded"
#   publish  (stage Publish)        PATCH draft=false (a -pre VERSION as a prerelease, make_latest=false), check
#            the tag points at RELEASE_SHA and that the release reads "immutable": true. With DRY_RUN=true the
#            verified draft is deleted instead. DRY_RUN must be set: this phase never guesses it.
#   cleanup  (post failure/aborted) delete the draft unless it was published
#
# Phases share the draft id through $STATE_DIR/state.env (required for a single phase; `all` makes a temporary
# one). `all` deletes the draft itself when a phase fails before the publish; for single phases that is the
# pipeline's `cleanup` call. A failure after GitHub published never deletes anything. The draft id is printed on
# stdout as "draft-id=<id>" when the macOS leg has succeeded.
#
# Environment:
#   REPO          owner/name of the repository (required)
#   VERSION       release tag, e.g. v0.20.0 (required, except cleanup)
#   RELEASE_SHA   full commit sha the release is cut from (required, except cleanup)
#   DIST          directory holding the electron-builder output (required for draft and all): *.AppImage and
#                 *.exe are uploaded
#   SBOM          the CycloneDX file to upload (default: $DIST/sbom.cdx.json)
#   SOURCE_DIR    checkout whose package.json is compared with VERSION (default: the current directory)
#   GH_TOKEN      GitHub token (required)
#   STATE_DIR     where the phases keep the draft id (required for a single phase)
#   DISPATCH_REF  branch whose macos-build.yml runs (default: master)
#   DRY_RUN       true: delete the verified draft instead of publishing it (default false; required for publish)
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

PHASE="${1:-all}"
case "$PHASE" in all | check | draft | macos | verify | publish | cleanup) ;; *) die "usage: $0 [all|check|draft|macos|verify|publish|cleanup]" ;; esac

: "${REPO:?}" "${GH_TOKEN:?}"
if [ "$PHASE" != cleanup ]; then
  : "${VERSION:?}" "${RELEASE_SHA:?}"
fi
if [ "$PHASE" = all ] || [ "$PHASE" = draft ]; then
  : "${DIST:?}"
  SBOM="${SBOM:-$DIST/sbom.cdx.json}"
fi
if [ "$PHASE" = publish ]; then
  : "${DRY_RUN:?}"
fi
SOURCE_DIR="${SOURCE_DIR:-.}"
DISPATCH_REF="${DISPATCH_REF:-master}"
DRY_RUN="${DRY_RUN:-false}"
MAC_TIMEOUT_MIN="${MAC_TIMEOUT_MIN:-45}"
POLL_SECONDS="${POLL_SECONDS:-15}"
RETRY_SECONDS="${RETRY_SECONDS:-5}"

OWN_STATE=false
if [ -z "${STATE_DIR:-}" ]; then
  [ "$PHASE" = all ] || die "STATE_DIR is required for the $PHASE phase"
  STATE_DIR=$(mktemp -d)
  OWN_STATE=true
fi
mkdir -p "$STATE_DIR"
state_file="$STATE_DIR/state.env"

# save KEY VALUE: the value is a number, a boolean or a [A-Za-z0-9-] token; the file is sourced back by load_state.
save() { printf '%s=%s\n' "$1" "$2" >> "$state_file"; }
RELEASE_ID=
PUBLISHED=false
RUN_ID=
CORR=
load_state() {
  if [ -f "$state_file" ]; then
    # shellcheck disable=SC1090
    . "$state_file"
  fi
  return 0
}
need_draft() {
  load_state
  [[ "$RELEASE_ID" =~ ^[0-9]+$ ]] || die "no draft id in $state_file; run the draft phase first"
}

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

# --- check: guards, nothing exists on GitHub yet
phase_check() {
  [[ "$VERSION" =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]] || die "VERSION $VERSION is not vMAJOR.MINOR.PATCH[-pre]"
  [[ "$RELEASE_SHA" =~ ^[0-9a-f]{40}$ ]] || die "RELEASE_SHA is not a full sha"
  [[ "$REPO" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || die "REPO $REPO is not owner/name"
  [[ "$DRY_RUN" =~ ^(true|false)$ ]] || die "DRY_RUN $DRY_RUN is not true or false"
  [[ "$MAC_TIMEOUT_MIN" =~ ^[0-9]+$ ]] || die "MAC_TIMEOUT_MIN $MAC_TIMEOUT_MIN is not a number"

  local pkg_version refs releases
  pkg_version=$(pyget 'd["version"]' < "$SOURCE_DIR/package.json")
  [ "$pkg_version" = "${VERSION#v}" ] || die "package.json version $pkg_version differs from ${VERSION#v}"

  refs=$(api GET "repos/$REPO/git/matching-refs/tags/$VERSION")
  [ "$(pyget 'any(r["ref"] == a[0] for r in d)' "refs/tags/$VERSION" <<<"$refs")" = false ] ||
    die "tag $VERSION already exists"
  releases=$(api GET "repos/$REPO/releases?per_page=100")
  [ "$(pyget 'sum(1 for r in d if r.get("tag_name") == a[0])' "$VERSION" <<<"$releases")" = 0 ] ||
    die "a release or draft already carries $VERSION; delete it first"
  [ "$(api GET "repos/$REPO/immutable-releases" | pyget 'd.get("enabled")')" = true ] ||
    die "immutable releases are off"
  log "$VERSION may be released: tag and release absent, immutable releases on"
}

# --- draft: by REST, keeping its numeric id, then the uploads by that id
phase_draft() {
  local assets=() f name prerelease
  for f in "$DIST"/*.AppImage "$DIST"/*.exe "$SBOM"; do
    [ -f "$f" ] && assets+=("$f")
  done
  { ls "$DIST"/*.AppImage "$DIST"/*.exe >/dev/null 2>&1 && [ -f "$SBOM" ]; } ||
    die "$DIST needs at least one .AppImage and one .exe, and $SBOM must exist"

  case "$VERSION" in *-*) prerelease=true ;; *) prerelease=false ;; esac
  RELEASE_ID=$(api POST "repos/$REPO/releases" \
    "{\"tag_name\":\"$VERSION\",\"target_commitish\":\"$RELEASE_SHA\",\"name\":\"$VERSION\",\"draft\":true,\"prerelease\":$prerelease,\"generate_release_notes\":true}" |
    pyget 'd["id"]')
  [[ "$RELEASE_ID" =~ ^[0-9]+$ ]] || die "no draft id (got: $RELEASE_ID)"
  save RELEASE_ID "$RELEASE_ID" # before the first upload: a failure from here on is cleaned up by id
  log "draft $RELEASE_ID created for $VERSION at $RELEASE_SHA"

  # electron-builder names contain spaces; GitHub turns them into dots
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
}

# --- macos: dispatch the build; return_run_details=true makes the API answer with the run id
phase_macos() {
  need_draft
  local title state i
  CORR="jenkins-$(printf '%s' "${BUILD_TAG:-local}" | tr -c 'A-Za-z0-9' '-')-$(date +%s)-$RANDOM"
  RUN_ID=$(api POST "repos/$REPO/actions/workflows/macos-build.yml/dispatches" \
    "{\"ref\":\"$DISPATCH_REF\",\"return_run_details\":true,\"inputs\":{\"tag\":\"$VERSION\",\"sha\":\"$RELEASE_SHA\",\"release_id\":\"$RELEASE_ID\",\"correlation_id\":\"$CORR\"}}" |
    pyget 'd.get("workflow_run_id")') || RUN_ID=
  if ! [[ "$RUN_ID" =~ ^[0-9]+$ ]]; then # fallback: find our run by the run-name marker
    RUN_ID=
    for i in $(seq 1 24); do
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
  for i in $(seq 1 12); do
    title=$(api GET "repos/$REPO/actions/runs/$RUN_ID" | pyget 'd.get("display_title")') || title=
    [[ "$title" == *"[$CORR]"* ]] && break
    sleep "$RETRY_SECONDS"
  done
  [[ "$title" == *"[$CORR]"* ]] || die "run $RUN_ID is [$title], not ours ($CORR)"
  save RUN_ID "$RUN_ID"
  log "macOS run $RUN_ID: https://github.com/$REPO/actions/runs/$RUN_ID"

  # wait for it, with a deadline; GitHub ends a run that never got a runner after ~15 min as a failure
  local deadline=$(($(date +%s) + MAC_TIMEOUT_MIN * 60))
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
}

# --- verify: the draft holds exactly the expected assets
phase_verify() {
  need_draft
  # GitHub turns the spaces of electron-builder's file names into dots
  local V=${VERSION#v} expected problems
  expected="S3.Browser-$V.AppImage S3.Browser.Setup.$V.exe S3.Browser.$V.exe S3.Browser-$V.dmg S3.Browser-$V-arm64.dmg sbom.cdx.json"
  problems=$(api GET "repos/$REPO/releases/$RELEASE_ID" | pyget '
(lambda have, want: "; ".join(
    (["missing " + ", ".join(sorted(set(want) - set(have)))] if set(want) - set(have) else [])
    + (["unexpected " + ", ".join(sorted(set(have) - set(want)))] if set(have) - set(want) else [])
    + (["duplicate assets"] if len(have) != len(set(have)) else [])
    + ["%s is %s, not uploaded" % (x["name"], x.get("state")) for x in d.get("assets", []) if x.get("state") != "uploaded"]
))([x["name"] for x in d.get("assets", [])], a[0].split())' "$expected")
  [ -z "$problems" ] || die "draft $RELEASE_ID does not hold the expected assets: $problems"
  log "draft $RELEASE_ID holds the expected assets"
}

# --- publish (or, for a dry run, delete) the verified draft, then read tag and immutable
phase_publish() {
  need_draft
  [[ "$DRY_RUN" =~ ^(true|false)$ ]] || die "DRY_RUN $DRY_RUN is not true or false"
  local prerelease latest tag_ref tag_sha immutable i
  if [ "$DRY_RUN" = true ]; then
    api DELETE "repos/$REPO/releases/$RELEASE_ID" >/dev/null || die "DRY_RUN: draft $RELEASE_ID could NOT be deleted; delete it by hand"
    save PUBLISHED true # deleted on purpose: the cleanup has nothing left to do
    log "DRY_RUN: draft $RELEASE_ID verified and deleted, nothing published"
    return 0
  fi

  case "$VERSION" in *-*) prerelease=true latest=false ;; *) prerelease=false latest=true ;; esac
  api PATCH "repos/$REPO/releases/$RELEASE_ID" \
    "{\"draft\":false,\"prerelease\":$prerelease,\"make_latest\":\"$latest\"}" >/dev/null
  save PUBLISHED true # from here on the release is public: nothing may delete it
  log "release $RELEASE_ID published"

  # the tag exists only after the publish: it must point at the candidate sha (a tag object is peeled)
  tag_ref=$(api GET "repos/$REPO/git/ref/tags/$VERSION")
  tag_sha=$(pyget 'd["object"]["sha"]' <<<"$tag_ref")
  if [ "$(pyget 'd["object"]["type"]' <<<"$tag_ref")" = tag ]; then
    tag_sha=$(api GET "repos/$REPO/git/tags/$tag_sha" | pyget 'd["object"]["sha"]')
  fi
  [ "$tag_sha" = "$RELEASE_SHA" ] || die "PUBLISHED but tag $VERSION points at $tag_sha, not $RELEASE_SHA"

  # the immutable flag is read after the publish; GitHub seals the release a moment later
  immutable=
  for i in $(seq 1 12); do
    immutable=$(api GET "repos/$REPO/releases/$RELEASE_ID" | pyget 'd.get("immutable")') || immutable=
    [ "$immutable" = true ] && break
    sleep "$RETRY_SECONDS"
  done
  [ "$immutable" = true ] || die "PUBLISHED but release $RELEASE_ID reads immutable: ${immutable:-unknown}"
  log "release $RELEASE_ID is immutable, tag $VERSION at $RELEASE_SHA"
}

# --- cleanup: a draft that was never published must not outlive a failed or aborted build
phase_cleanup() {
  load_state
  if ! [[ "$RELEASE_ID" =~ ^[0-9]+$ ]]; then
    log "no draft was created; nothing to clean up"
  elif [ "$PUBLISHED" = true ]; then
    log "release $RELEASE_ID is published or already removed; not touching it"
  elif api DELETE "repos/$REPO/releases/$RELEASE_ID" >/dev/null; then
    save PUBLISHED true
    log "FAILED: draft $RELEASE_ID deleted"
  else
    log "FAILED: draft $RELEASE_ID could NOT be deleted; delete it by hand"
    return 1
  fi
}

if [ "$PHASE" != all ]; then
  "phase_$PHASE"
  exit 0
fi

# all: one process; a failure before the publish deletes the draft
on_exit() {
  local rc=$?
  trap - EXIT
  if [ "$rc" != 0 ]; then
    phase_cleanup || true
  fi
  if [ "$OWN_STATE" = true ]; then rm -rf "$STATE_DIR"; fi
  exit "$rc"
}
trap on_exit EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

phase_check
phase_draft
phase_macos
phase_verify
phase_publish
