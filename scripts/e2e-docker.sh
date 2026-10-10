#!/usr/bin/env bash
# Run the Playwright Electron e2e suite fully inside containers (no display, no host Electron):
# a LocalStack container plus a Playwright-image container running Electron under xvfb.
# Usage: scripts/e2e-docker.sh [playwright args...]   e.g. scripts/e2e-docker.sh e2e/app-launch.e2e.ts
# A `--shard=<i>/<n>` (or `--shard <i>/<n>`) argument is forwarded to `playwright test` as every other argument is,
# and its index <i> is part of the docker network and LocalStack container names.
# Safe to run concurrently (resource names are suffixed with a unique run id and the shard index).
set -euo pipefail

cd "$(dirname "$0")/.."

PLAYWRIGHT_VERSION=$(node -p "require('./package-lock.json').packages['node_modules/@playwright/test'].version")
PLAYWRIGHT_IMAGE="mcr.microsoft.com/playwright:v${PLAYWRIGHT_VERSION}-noble"
LOCALSTACK_IMAGE="localstack/localstack:3.8"

# Shard index from a --shard=<i>/<n> or --shard <i>/<n> argument ("0" when the run is not sharded).
SHARD_INDEX=0
prev=""
for arg in "$@"; do
  if [[ "$arg" =~ ^--shard=([0-9]+)/[0-9]+$ ]]; then
    SHARD_INDEX="${BASH_REMATCH[1]}"
  elif [[ "$prev" == "--shard" && "$arg" =~ ^([0-9]+)/[0-9]+$ ]]; then
    SHARD_INDEX="${BASH_REMATCH[1]}"
  fi
  prev="$arg"
done

RUN_ID="${GITHUB_RUN_ID:-local}-${GITHUB_RUN_ATTEMPT:-0}-shard${SHARD_INDEX}-$$"
NET="s3b-e2e-${RUN_ID}"
LS="s3b-localstack-${RUN_ID}"
NPM_CACHE="${S3B_NPM_CACHE:-$HOME/.cache/s3b-e2e-npm}"

mkdir -p "$NPM_CACHE"

cleanup() {
  docker rm -f "$LS" >/dev/null 2>&1 || true
  docker network rm "$NET" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker network create "$NET" >/dev/null
docker run -d --name "$LS" --network "$NET" --network-alias localstack \
  -e SERVICES=s3 -e DEBUG=0 -e AWS_DEFAULT_REGION=us-east-1 -e DISABLE_EVENTS=1 \
  "$LOCALSTACK_IMAGE" >/dev/null

# Run as the invoking user so files created in the bind-mounted workspace stay deletable.
# Isolated node_modules per run would be slower; reuse the workspace's but build inside the container (Linux binaries).
docker run --rm --network "$NET" --ipc=host \
  --user "$(id -u):$(id -g)" \
  -v "$PWD:/app" -v "$NPM_CACHE:/npm-cache" -w /app \
  -e HOME=/tmp/home -e npm_config_cache=/npm-cache \
  -e LOCALSTACK_ENDPOINT=http://localstack:4566 \
  -e CI="${CI:-}" \
  "$PLAYWRIGHT_IMAGE" \
  bash -euo pipefail -c '
    mkdir -p "$HOME"
    npm ci --no-audit --no-fund
    npm run build
    xvfb-run --auto-servernum --server-args="-screen 0 1280x960x24" npx playwright test "$@"
  ' _ "$@"
