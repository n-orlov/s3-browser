#!/usr/bin/env bash
# Smoke-test a packaged Linux AppImage headless, inside the Playwright image scripts/e2e-docker.sh uses.
# Usage: scripts/smoke-appimage.sh [path/to/App.AppImage]   (default: the single release/*.AppImage)
#
# The AppImage is extracted (--appimage-extract, no FUSE needed), its AppRun is launched under xvfb, and the
# script exits 0 only when a page with the app title (S3B_SMOKE_TITLE, default "S3 Browser") shows up in
# Chromium's remote-debugging target list AND the process is still alive S3B_SMOKE_HOLD seconds later (default 5).
# Any other outcome (process exits early, no window, wrong title) exits non-zero.
#
# The files are handed to the container with `docker cp` rather than a bind mount, so the script also works
# when it runs inside another container (host-path bind mounts do not).
# S3B_SMOKE_DOCKER_ARGS adds extra `docker create` arguments (e.g. labels).
# Internal mode: S3B_SMOKE_INNER=1 runs the checks in the current environment (this is what the container runs).
set -euo pipefail

TITLE="${S3B_SMOKE_TITLE:-S3 Browser}"
HOLD="${S3B_SMOKE_HOLD:-5}"
WAIT="${S3B_SMOKE_WAIT:-60}"
PORT=9222

inner() {
  local appimage="$1" work
  work="$(mktemp -d)"
  cd "$work"
  cp "$appimage" ./app.AppImage
  chmod +x ./app.AppImage
  ./app.AppImage --appimage-extract >/dev/null
  [[ -x squashfs-root/AppRun ]] || { echo "smoke: extraction produced no squashfs-root/AppRun" >&2; exit 1; }

  # --no-sandbox: the container runs as root, where Chromium refuses to start its sandbox, and AppRun's own probe for it
  #   (`unshare -Ur`) always succeeds as root; passing it explicitly keeps the result independent of the runner's kernel.
  # --remote-debugging-port: lets us read the window's page title without an X11 client tool (the image has none).
  xvfb-run --auto-servernum --server-args="-screen 0 1280x960x24" \
    ./squashfs-root/AppRun --no-sandbox --remote-debugging-port="$PORT" >app.log 2>&1 &
  local pid=$!

  local found="" i
  for ((i = 0; i < WAIT * 2; i++)); do
    if ! kill -0 "$pid" 2>/dev/null; then
      echo "smoke: FAIL - app exited before a window opened"; tail -n 20 app.log; exit 1
    fi
    found="$(node -e '
      fetch("http://127.0.0.1:" + process.argv[1] + "/json").then((r) => r.json()).then((t) => {
        const p = t.find((x) => x.type === "page" && x.title === process.argv[2]);
        if (p) process.stdout.write(p.title);
      }).catch(() => {});' "$PORT" "$TITLE" 2>/dev/null || true)"
    [[ -n "$found" ]] && break
    sleep 0.5
  done
  if [[ -z "$found" ]]; then
    echo "smoke: FAIL - no window titled \"$TITLE\" within ${WAIT}s"; tail -n 20 app.log; exit 1
  fi
  echo "smoke: window opened, title: \"$found\""

  sleep "$HOLD"
  if ! kill -0 "$pid" 2>/dev/null; then
    echo "smoke: FAIL - app exited within ${HOLD}s of opening its window"; tail -n 20 app.log; exit 1
  fi
  echo "smoke: OK - app still running ${HOLD}s after opening \"$found\""
  kill "$pid" 2>/dev/null || true
  wait "$pid" 2>/dev/null || true
}

if [[ "${S3B_SMOKE_INNER:-}" == "1" ]]; then
  inner "$1"
  exit 0
fi

cd "$(dirname "$0")/.."
APPIMAGE="${1:-}"
if [[ -z "$APPIMAGE" ]]; then
  shopt -s nullglob
  candidates=(release/*.AppImage)
  [[ ${#candidates[@]} -eq 1 ]] || { echo "smoke: expected exactly one release/*.AppImage, found ${#candidates[@]}" >&2; exit 2; }
  APPIMAGE="${candidates[0]}"
fi
[[ -f "$APPIMAGE" ]] || { echo "smoke: $APPIMAGE does not exist" >&2; exit 2; }

PLAYWRIGHT_VERSION=$(node -p "require('./package-lock.json').packages['node_modules/@playwright/test'].version")
PLAYWRIGHT_IMAGE="mcr.microsoft.com/playwright:v${PLAYWRIGHT_VERSION}-noble"

# shellcheck disable=SC2086
CID="$(docker create ${S3B_SMOKE_DOCKER_ARGS:-} --ipc=host -e S3B_SMOKE_INNER=1 -e S3B_SMOKE_TITLE="$TITLE" -e S3B_SMOKE_HOLD="$HOLD" -e S3B_SMOKE_WAIT="$WAIT" \
  --entrypoint bash "$PLAYWRIGHT_IMAGE" -c 'exec bash /smoke-appimage.sh /app.AppImage')"
trap 'docker rm -f "$CID" >/dev/null 2>&1 || true' EXIT
docker cp "$APPIMAGE" "$CID:/app.AppImage"
docker cp "$(dirname "$0")/smoke-appimage.sh" "$CID:/smoke-appimage.sh"
docker start -a "$CID"
