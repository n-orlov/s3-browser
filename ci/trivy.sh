#!/usr/bin/env bash
# Blocking Trivy gate: scans the repository (vuln + secret + misconfig, HIGH and CRITICAL,
# development dependencies included) with a pinned Trivy image and exits non-zero on any finding.
#
# Usage: ci/trivy.sh [--fresh]
#   --fresh  drop the cached vulnerability DB first so the scan downloads a new one (nightly lane).
# Environment:
#   TRIVY_SCAN_ROOT     directory to scan (default: the repository root)
#   TRIVY_CACHE_VOLUME  named docker volume that caches the DB (default: s3b-trivy-cache)
#
# The tree is streamed into the scanner container with `docker cp`, so the script works the
# same on a host and inside a container that talks to the host docker daemon (no bind-mount paths).
set -euo pipefail

IMAGE="aquasec/trivy:0.76.1@sha256:790fd66d1697395d8693d1acaa1ea702406a20f109b6fc7bac8db623eca6c06c"
VOLUME="${TRIVY_CACHE_VOLUME:-s3b-trivy-cache}"
ROOT="${TRIVY_SCAN_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"

fresh=0
case "${1:-}" in
  "") ;;
  --fresh) fresh=1 ;;
  *) echo "usage: ci/trivy.sh [--fresh]" >&2; exit 2 ;;
esac

docker volume create "$VOLUME" >/dev/null

if [ "$fresh" = 1 ]; then
  echo "trivy: --fresh, removing the cached vulnerability DB from volume $VOLUME"
  docker run --rm --memory 256m -v "$VOLUME:/cache" --entrypoint sh "$IMAGE" \
    -c 'rm -rf /cache/db /cache/java-db'
fi

CONTAINER="$(docker create --memory 2g -v "$VOLUME:/cache" "$IMAGE" \
  fs \
  --cache-dir /cache \
  --scanners vuln,secret,misconfig \
  --severity HIGH,CRITICAL \
  --include-dev-deps \
  --exit-code 1 \
  /tmp)"
trap 'docker rm -f "$CONTAINER" >/dev/null 2>&1 || true' EXIT

# Build outputs, VCS data and installed packages are not part of the scanned tree. Only options
# BusyBox tar (the phone agents) also knows are used: the tree lands in the image's empty /tmp.
tar -C "$ROOT" \
  --exclude=./node_modules --exclude=./.git --exclude=./dist --exclude=./release \
  --exclude=./coverage --exclude=./reports --exclude=./sbom --exclude=./junit \
  --exclude=./allure-results --exclude=./allure-results-unit --exclude=./playwright-report \
  --exclude=./test-results --exclude=./.stryker-tmp --exclude=./ci-results \
  -cf - . | docker cp - "$CONTAINER:/tmp"

docker start -a "$CONTAINER"
