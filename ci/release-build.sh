#!/usr/bin/env bash
# Builds the release assets that Jenkinsfile.release hands to ci/release-stage.sh, from one commit:
#   S3 Browser-<version>.AppImage       x64 AppImage (electron-builder --linux AppImage --x64), then the headless smoke
#                                       test scripts/smoke-appimage.sh against that very file
#   S3 Browser Setup <version>.exe      Windows NSIS installer   } electron-builder --win nsis portable --x64,
#   S3 Browser <version>.exe            Windows portable         } in the electronuserland/builder:wine image
#   sbom.cdx.json                       CycloneDX SBOM of the production dependencies (npm run sbom)
# It needs an amd64 host: the smoke test runs the x64 AppImage and wine only exists for x64.
#
# Usage: ci/release-build.sh [--sha SHA] [--out DIR]
#   --sha SHA   commit to build (default HEAD); the tree is taken with `git archive`, so uncommitted changes never leak in
#   --out DIR   directory the four files are copied to (default release-out); created if missing
# Environment:
#   BUILD_MEMORY   --memory cap of every docker container this script starts (default 3g)
#   NODE_IMAGE / WINE_IMAGE   the node and electron-builder images (defaults node:22, electronuserland/builder:wine)
#   CACHE_VOLUME   named docker volume for the Electron and electron-builder downloads (default s3b-release-cache)
#
# The sources are handed to the containers with `docker cp` rather than a bind mount, so the script also works when it
# runs inside another container (host-path bind mounts would be empty there). Every container is removed on exit.
set -euo pipefail

SHA=HEAD
OUT=release-out
while [ $# -gt 0 ]; do
  case "$1" in
    --sha) SHA=${2:?--sha needs a value}; shift 2 ;;
    --out) OUT=${2:?--out needs a value}; shift 2 ;;
    *) echo "release-build: unknown argument: $1" >&2; exit 2 ;;
  esac
done

BUILD_MEMORY="${BUILD_MEMORY:-3g}"
NODE_IMAGE="${NODE_IMAGE:-node:22}"
WINE_IMAGE="${WINE_IMAGE:-electronuserland/builder:wine}"
CACHE_VOLUME="${CACHE_VOLUME:-s3b-release-cache}"

log() { printf '%s release-build: %s\n' "$(date -u +%H:%M:%S)" "$*" >&2; }

cd "$(git rev-parse --show-toplevel)"
SHA="$(git rev-parse --verify "$SHA^{commit}")"
mkdir -p "$OUT"
OUT="$(cd "$OUT" && pwd)"
WORK="$(mktemp -d)"
RUN_ID="$$-$(date +%s)"
CONTAINERS=()
cleanup() {
  local c
  for c in "${CONTAINERS[@]+"${CONTAINERS[@]}"}"; do docker rm -f -v "$c" >/dev/null 2>&1 || true; done
  rm -rf "$WORK"
}
trap cleanup EXIT

log "building $SHA into $OUT (memory cap $BUILD_MEMORY per container)"
mkdir -p "$WORK/src" "$WORK/linux" "$WORK/win"
git archive "$SHA" | tar -x -C "$WORK/src"

# build_in IMAGE NAME SCRIPT: runs SCRIPT (bash) in a throwaway container on a copy of the source tree.
# The container is left stopped so the caller can `docker cp` the results out of it.
build_in() {
  local image=$1 name="s3b-release-$2-$RUN_ID" script=$3
  CONTAINERS+=("$name")
  docker create --name "$name" --memory "$BUILD_MEMORY" --label ralphd.role=release-build \
    -v "$CACHE_VOLUME:/cache" -e ELECTRON_CACHE=/cache/electron -e ELECTRON_BUILDER_CACHE=/cache/electron-builder \
    -e npm_config_cache=/cache/npm -e CI=true -w /project "$image" bash -ec "$script" >/dev/null
  tar -C "$WORK/src" -cf - . | docker cp - "$name:/project"
  docker start -a "$name"
}

# 1. Linux: the x64 AppImage (--x64 explicit, so the result never depends on the host's architecture) and the SBOM.
log "Linux AppImage and SBOM"
build_in "$NODE_IMAGE" linux 'npm ci --no-audit --no-fund && npm run build && npm run sbom && npx electron-builder --linux AppImage --x64 -p never'
docker cp "s3b-release-linux-$RUN_ID:/project/release/." "$WORK/linux"
docker cp "s3b-release-linux-$RUN_ID:/project/sbom/sbom.cdx.json" "$WORK/linux/sbom.cdx.json"

# 2. The smoke test runs the extracted AppImage headless in the Playwright image, from this checkout's lockfile.
APPIMAGE=("$WORK"/linux/*.AppImage)
[ ${#APPIMAGE[@]} -eq 1 ] && [ -f "${APPIMAGE[0]}" ] || { echo "release-build: expected exactly one AppImage" >&2; exit 1; }
log "smoke test of ${APPIMAGE[0]##*/}"
(cd "$WORK/src" && S3B_SMOKE_DOCKER_ARGS="--memory $BUILD_MEMORY" bash scripts/smoke-appimage.sh "${APPIMAGE[0]}")

# 3. Windows: NSIS installer and portable exe through wine (the existing scripts/build-windows.sh image).
log "Windows NSIS and portable"
build_in "$WINE_IMAGE" win 'npm ci --no-audit --no-fund && npm run build && npx electron-builder --win nsis portable --x64 -p never'
docker cp "s3b-release-win-$RUN_ID:/project/release/." "$WORK/win"

# 4. Collect exactly the four release files.
VERSION="$(sed -n 's/^  "version": "\(.*\)",$/\1/p' "$WORK/src/package.json" | head -n 1)"
[ -n "$VERSION" ] || { echo "release-build: no version in package.json at $SHA" >&2; exit 1; }
cp "$WORK/linux/S3 Browser-$VERSION.AppImage" "$WORK/win/S3 Browser Setup $VERSION.exe" "$WORK/win/S3 Browser $VERSION.exe" \
  "$WORK/linux/sbom.cdx.json" "$OUT/"
log "done:"
ls -l "$OUT" >&2
