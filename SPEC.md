# S3 Browser — Specification

S3 Browser is a desktop Electron application for browsing and editing objects in Amazon S3 (and S3-compatible endpoints). This document describes the product as the code implements it. The tests in `src/__tests__/` and this file are the tracked evidence for its behaviour.

## 1. Process model

The application has three kinds of code, each built by its own script.

| Process | Source | Build output | Role |
| --- | --- | --- | --- |
| Main | `src/main/` (`index.ts`, `ipc/`, `services/`) | `dist/main/` (`tsc -p tsconfig.main.json`) | Owns the window, the AWS SDK clients, the file system and every IPC handler. |
| Preload | `src/preload/index.ts` | `dist/preload/` (`tsc -p tsconfig.preload.json`) | Runs in an isolated context before the page and exposes `window.electronAPI` through `contextBridge`. |
| Renderer | `src/renderer/` (React 19) | `dist/renderer/` (`vite build`) | The user interface. It has no Node.js access and reaches the main process only through `window.electronAPI`. |

- `src/main/index.ts` enforces a single application instance (`app.requestSingleInstanceLock`); a second launch focuses the existing window. On `app.whenReady` it registers `registerCredentialsIpc`, `registerS3Ipc` and `registerAppStateIpc`, then creates one `BrowserWindow` (1200x800, minimum 800x600, no application menu). In development (`NODE_ENV=development`) it loads `http://localhost:5173`; otherwise it loads `dist/renderer/index.html`.
- The preload script exposes `platform` plus three groups of functions, each of which is a thin wrapper around `ipcRenderer.invoke` on one channel from section 2: `appState` (persistence), `aws` (profiles) and `s3` (bucket and object operations). `electronAPI.getObjectMetadata` is an alias for `s3.getObjectMetadata` and invokes the same channel.
- All requests are renderer-initiated request/response calls (`ipcRenderer.invoke` / `ipcMain.handle`). The main process sends no unsolicited events to the renderer.
- The main process holds the selected AWS profile name in memory (set by `aws:set-profile`). Every `s3:*` handler that talks to S3 resolves credentials from that profile. When none is selected, each of them returns `{ success: false, error: 'No AWS profile selected. Please select a profile first.' }` (`s3:delete-prefix` adds `deletedCount: 0, failedCount: 1`), with two exceptions that carry no `error` field:
  - `s3:upload-files` returns `{ success: false, results: [] }`;
  - `s3:delete-files` returns `{ success: false, results: [], deletedCount: 0, failedCount: <number of keys> }`.

## 2. IPC surface

Every channel is registered with `ipcMain.handle` by one of `registerCredentialsIpc` (`src/main/ipc/credentials.ts`), `registerAppStateIpc` (`src/main/ipc/appState.ts`) or `registerS3Ipc` (`src/main/ipc/s3.ts`). The tables below list each channel in the first column in backticks; the unit test `src/__tests__/ipcSpecParity.test.ts` fails when this list differs from the set of registered channels, or when the preload script invokes a channel that is not registered. Arguments are the positional parameters after the implicit event.

Result shapes: `FileOperationResult` is `{ success: boolean; error?: string }`. `ObjectMetadata` is the object's content type, size, last-modified time, ETag, storage class, tags and custom metadata.

### 2.1 Credentials

| Channel | Arguments | Returns | Invalid input |
| --- | --- | --- | --- |
| `aws:get-profiles` | none | `CredentialsState`: `{ profiles: ProfileInfo[]; currentProfile: string \| null; defaultRegion?: string }` | none (arguments ignored) |
| `aws:set-profile` | `profileName: string` (non-empty) | `{ success: boolean; error?: string }`; fails for an unknown or invalid profile | `{ success: false, error }` |
| `aws:get-current-profile` | none | `string \| null` | none (arguments ignored) |
| `aws:get-profile-details` | `profileName: string` | profile details with credentials masked, or `null` for an unknown profile | `null` |
| `aws:refresh-profiles` | none | `CredentialsState`, re-read from disk; clears the current profile if it no longer exists | none (arguments ignored) |

### 2.2 App state

| Channel | Arguments | Returns | Invalid input |
| --- | --- | --- | --- |
| `app-state:load` | none | `AppStateData`: `{ lastProfile: string \| null; lastBucket: string \| null; lastPrefix: string }` | none (arguments ignored) |
| `app-state:save` | `data: Partial<AppStateData>` (a plain object with only `lastProfile`, `lastBucket`: string or `null`, `lastPrefix`: string) | `{ success: boolean; error?: string }` | `{ success: false, error }` |

### 2.3 S3

| Channel | Arguments | Returns | Invalid input |
| --- | --- | --- | --- |
| `s3:list-buckets` | none | `{ success; buckets?: S3Bucket[]; error? }` | none (arguments ignored) |
| `s3:list-objects` | `options: ListObjectsOptions` (plain object: `bucket` a bucket name, `prefix?` and `delimiter?` strings, `maxKeys?` a positive integer, `continuationToken?` a non-empty string; other properties are invalid) | `{ success; result?: ListObjectsResult; error? }` | `{ success: false, error }` |
| `s3:list-all-objects` | `options: Omit<ListObjectsOptions, 'continuationToken'>`, `operationId: string` | `{ success; result?: ListObjectsResult; error? }`; cancellable through `operationId` | `{ success: false, error }` |
| `s3:cancel-operation` | `operationId: string` | `boolean`, `true` when a running operation was aborted | `false` |
| `s3:parse-url` | `url: string` | `{ success; bucket?; key?; error? }` | `{ success: false, error }` |
| `s3:get-parent-prefix` | `keyOrPrefix: string` | `string` | `''` |
| `s3:get-key-name` | `keyOrPrefix: string` | `string` | `''` |
| `s3:clear-client` | none | `void`; drops the cached S3 client | none (arguments ignored) |
| `s3:download-file` | `bucket: string`, `key: string`, `operationId: string` | `FileOperationResult & { localPath?: string }`; writes into the user's downloads folder, adding ` (n)` before the extension when the name exists | `{ success: false, error }` |
| `s3:upload-file` | `bucket: string`, `prefix: string`, `filePath: string`, `operationId: string` | `FileOperationResult` | `{ success: false, error }` |
| `s3:upload-files` | `bucket: string`, `prefix: string`, `filePaths: string[]`, `operationId: string` | `{ success; results: { path; success; error? }[] }`; no top-level `error` (see section 3, Errors) | `{ success: false, results: [] }` |
| `s3:delete-file` | `bucket: string`, `key: string` | `FileOperationResult` | `{ success: false, error }` |
| `s3:delete-files` | `bucket: string`, `keys: string[]` | `DeleteFilesResult`: `{ success; results: { key; success; error? }[]; deletedCount; failedCount }`; no top-level `error` (see section 3, Errors) | `{ success: false, results: [], deletedCount: 0, failedCount: 0 }` |
| `s3:delete-prefix` | `bucket: string`, `prefix: string` | `DeletePrefixResult`: `{ success; deletedCount; failedCount; error? }` | `{ success: false, deletedCount: 0, failedCount: 0, error }` |
| `s3:rename-file` | `bucket: string`, `sourceKey: string`, `newName: string` | `FileOperationResult`; copies to the same parent prefix under the new name, then deletes the source | `{ success: false, error }` |
| `s3:copy-file` | `sourceBucket: string`, `sourceKey: string`, `destinationBucket: string`, `destinationKey: string` | `FileOperationResult` | `{ success: false, error }` |
| `s3:upload-content` | `bucket: string`, `key: string`, `content: string` | `FileOperationResult`; gzip-compresses the content when the key ends in `.gz` | `{ success: false, error }` |
| `s3:download-content` | `bucket: string`, `key: string` | `{ success; content?: string; error? }`; gunzips keys ending in `.gz`; size-capped (see below) | `{ success: false, error }` |
| `s3:get-file-size` | `bucket: string`, `key: string` | `{ success; size?: number; error? }` | `{ success: false, error }` |
| `s3:download-binary-content` | `bucket: string`, `key: string` | `{ success; data?: Uint8Array; error? }`; size-capped (see below) | `{ success: false, error }` |
| `s3:show-open-dialog` | none | `string[] \| null`; native multi-file open dialog, `null` when cancelled | none (arguments ignored) |
| `s3:open-downloads-folder` | none | `void`; opens the downloads folder in the system file manager | none (arguments ignored) |
| `s3:show-file-in-folder` | `filePath: string` | `void`; reveals the file in the system file manager | `undefined` (nothing is revealed) |
| `s3:get-object-metadata` | `bucket: string`, `key: string` | `{ success; metadata?: ObjectMetadata; error? }` | `{ success: false, error }` |
| `s3:create-file` | `bucket: string`, `key: string` | `FileOperationResult`; creates an empty object | `{ success: false, error }` |
| `s3:create-folder` | `bucket: string`, `prefix: string` | `FileOperationResult`; creates a zero-byte folder marker object | `{ success: false, error }` |

**Argument validation.** Every handler checks its positional arguments with the helper in `src/main/ipc/validate.ts` before doing any work; the renderer is not trusted. Argument types are: a *bucket name* is a non-empty string of at most 255 characters without `/`; an *object key* is a non-empty string of at most 1024 UTF-8 bytes; a *key prefix* is a string of at most 1024 UTF-8 bytes that may be empty (`prefix` of `s3:delete-prefix` and `s3:create-folder` must be non-empty); a *non-empty string* is at most 4096 characters (profile names, operation ids, local file paths, URLs); `string[]` arguments (`keys`, `filePaths`) are arrays whose items are all object keys, respectively non-empty strings; `newName` is an object key; `content` and `keyOrPrefix` are strings that may be empty. No string may contain a NUL character. Extra arguments are ignored. An argument of the wrong type, a missing argument or a value outside these shapes makes the call resolve (it never rejects) to the *Invalid input* column and the handler body does not run: no S3 request, no filesystem access, no dialog and no shell call. Where the result type has the `{ success, error }` shape the invalid-input result is `{ success: false, error }` with `error` of the form `Invalid argument '<name>': expected <shape>`; otherwise it is the neutral value in the column. The unit test `src/__tests__/ipcValidation.test.ts` holds one row per channel and fails when a registered channel has none.

**Content-read size cap.** `s3:download-content` (text and gzip) and `s3:download-binary-content` (binary, parquet, image) send a HEAD request first and compare `ContentLength` with the cap, 50 MB (`50 * 1024 * 1024` bytes) by default, defined in `src/main/contentLimits.ts` and overridable with the positive-integer environment variable `S3_BROWSER_MAX_CONTENT_BYTES` (bytes). An object above the cap resolves to `{ success: false, error }` where `error` names the limit, and no `GetObject` request is made. The cap applies to the stored size, so a `.gz` object is measured compressed; gunzip output is bounded separately by the same cap (`decompressGzip` in `src/main/services/gzipUtils.ts` passes it as `maxOutputLength`), so a small gzip bomb resolves to `{ success: false, error }` (`Gzip decompression failed: Decompressed content exceeds the maximum size of 50 MB (52428800 bytes).`) instead of exhausting memory. The helper `tryDecompressGzip` falls back to raw text for non-gzip input but rethrows that cap error. A failing HEAD resolves to `{ success: false, error }` with the service message and no download follows.

## 3. Security model

The following is what the code implements; behaviour that is absent is stated as absent.

- **Window isolation.** The `BrowserWindow` is created with `contextIsolation: true`, `nodeIntegration: false` and `sandbox: true`. The renderer cannot `require` Node modules; its only bridge is the `electronAPI` object built in the preload script.
- **Content Security Policy.** `src/renderer/index.html` sets `default-src 'self'; script-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' blob:; worker-src blob:; font-src 'self';`. No directive allows a remote (`http:`/`https:`) origin; `src/__tests__/csp.test.ts` parses the policy and fails if one appears. The Monaco editor is bundled from the `monaco-editor` package in `node_modules`: `src/renderer/monacoSetup.ts` passes it to the `@monaco-editor/react` loader (`loader.config({ monaco })`, so no CDN loader path is in effect) and serves its web workers as inlined blob workers built from the same package.
- **Credentials.** AWS credentials are read in the main process from the standard AWS shared config and credentials files and never cross the IPC boundary in clear text. `aws:get-profile-details` masks the access key (first and last four characters), replaces the secret key and session token with `********` and the credential process with `(configured)`. `getCurrentProfileCredentials` is internal to the main process.
- **External links.** `src/main/windowSecurity.ts` (`secureWebContents`, called from `createWindow`) installs a `setWindowOpenHandler` that denies every new window. It passes the requested URL to `shell.openExternal` only when `isExternalOpenAllowed` (`src/main/externalUrlPolicy.ts`) accepts it: the scheme must be `https:` or `mailto:`. `http:`, `file:`, `javascript:`, `data:`, custom protocols and strings that do not parse as a URL are denied and never reach `shell.openExternal`.
- **Navigation.** `secureWebContents` handles `will-navigate` and `will-redirect` on the main window's `webContents` and calls `preventDefault` for any target outside the application origin (the Vite dev server origin in development; the exact `index.html` file URL in production, ignoring query and fragment). Same-origin navigation proceeds. A blocked navigation is not forwarded to the system browser.
- **IPC input.** Every `ipcMain.handle` handler validates the shape of its arguments at runtime through `src/main/ipc/validate.ts` before doing any work, in addition to typing them with TypeScript (section 2, *Argument validation*). A call with an invalid argument resolves to the invalid-input result and the handler body does not run.
- **Errors.** Invalid arguments never reach these paths: they resolve to the invalid-input result of section 2. Every `s3:*` handler whose result has a `success` field catches errors thrown by the AWS SDK or the file system and returns `{ success: false, error }` (for `s3:delete-prefix`, together with `deletedCount: 0, failedCount: 1`), except two that return no `error`: `s3:upload-files` reports per-file failures in `results[].error`, and an error escaping the loop yields `{ success: false, results: [] }`, dropping the results already collected; `s3:delete-files` reports per-key failures in `results[].error`, and an error escaping the loop yields `{ success: false, results: [], deletedCount: 0, failedCount: keys.length }`. `app-state:save` returns `{ success: false, error }` when the state file cannot be written. The `aws:*` handlers, `app-state:load`, `s3:cancel-operation`, `s3:get-parent-prefix`, `s3:get-key-name`, `s3:clear-client`, `s3:show-open-dialog`, `s3:open-downloads-folder` and `s3:show-file-in-folder` have no handler-level catch; an error that reaches them rejects the renderer's `invoke` promise.
- **Downloads.** `s3:download-file` writes into the downloads folder using the final path segment of the key as the file name.
- **Single instance.** A second application instance quits immediately.

## 4. Quality gates

All gates run locally with the `package.json` scripts; CI runs the same commands.

| Script | Command | Gate |
| --- | --- | --- |
| `typecheck` | `tsc -p tsconfig.typecheck.json` | Type-checks `src`, `e2e` and the config files, tests included. |
| `lint` | `eslint . --max-warnings 4` | ESLint; the warning count may only go down. |
| `test:coverage` | `vitest run --coverage` | Unit tests (jsdom) with V8 coverage; thresholds in `vitest.config.ts` are lines 80, functions 78, branches 70, statements 78. `src/main/index.ts` and `src/preload/index.ts` are excluded from coverage. |
| `crap` | `node scripts/crap/crap.ts` | CRAP gate, run after `test:coverage` (see below). |
| `ratchet:check` | `node scripts/ratchet/ratchet.ts` | Ratchet gate, run after `test:coverage` (see below). |
| `audit:prod` | `npm audit --omit=dev --audit-level=high` | Fails on a high or critical advisory in production dependencies. |
| `build` | `build:renderer`, `build:main`, `build:preload` | Produces `dist/`. |
| `test:e2e:docker` | `./scripts/e2e-docker.sh` | Runs the Playwright Electron suite in `e2e/` against LocalStack, entirely in containers: a LocalStack container plus a Playwright-image container that runs `npm ci`, `npm run build` and `xvfb-run npx playwright test`. Arguments, including `--shard=<i>/<n>`, are forwarded to `playwright test`. Container, network and run names carry `GITHUB_RUN_ID`, `GITHUB_RUN_ATTEMPT`, the shard index (`0` when unsharded) and the shell pid so concurrent runs and shards on one host do not collide. |

**CRAP gate.** `npm run crap` scores every function in `src/main`, `src/preload`, `src/renderer` and `src/shared` (the directories that exist; tests and `.d.ts` files are skipped) as `CRAP = c^2 * (1 - cov)^3 + c`, where `c` is the function's cyclomatic complexity from ESLint's `complexity` rule and `cov` is the fraction of the function's own statements (nested functions excluded) that ran, read from `coverage/coverage-final.json`. A function in a file that has no coverage entry has `cov = 0`. Scoring is `scripts/crap/crapScore.ts`; the CLI is `scripts/crap/crap.ts`. The command prints each offending function as `CRAP <score>  <file>:<qualified name>` and exits non-zero when any function fails; it exits `2` when `coverage/coverage-final.json` is missing, so run `npm run test:coverage` first. A function id is `<file>:<qualified name>` (repeated names in a file get `#2`, `#3`, ... in source order).

- **Limit.** A function not in the baseline fails when its score exceeds `CRAP_MAX` (environment variable, default `30`).
- **Baseline.** `crap-baseline.json` maps function ids to the score they had when the baseline was last written. It lists exactly the functions over `CRAP_MAX` at that time. `npm run crap -- --write-baseline` regenerates it from the current code and coverage (honouring `CRAP_MAX`); it is the only supported way to edit it.
- **Shrink-only.** A baselined function fails when its score exceeds its baseline entry, even if the score is below `CRAP_MAX`, so the baseline can only improve: lowering an entry by hand below the live score makes the gate fail, and a function that gets better is locked in by regenerating the baseline. Entries for functions that no longer exist are ignored and reported.

**Ratchet gate.** `.ratchet.json` records the quality ceiling and floors: `maxWarnings` (the lint warning ceiling) and `coverageThresholds` (`lines`, `functions`, `branches`, `statements`). `npm run ratchet:check` reads the `--max-warnings` value from the `lint` script in `package.json` and the four `coverage.thresholds` from `vitest.config.ts`, prints one `RATCHET` line per regression and exits `1` when `--max-warnings` is higher than `maxWarnings` or any threshold is lower than its recorded value; it exits `2` when an input is missing or unreadable, and `0` otherwise. A value that is stricter than the record passes and the command prints which `.ratchet.json` entries to tighten; editing `.ratchet.json` to a looser value is the only way to loosen the gate and is not done. Logic is `scripts/ratchet/ratchetCheck.ts`; the CLI is `scripts/ratchet/ratchet.ts` and runs from the repository root.

**No fixed sleeps in e2e.** `eslint.config.mjs` applies `no-restricted-syntax` at severity `error` to `e2e/**` with selectors matching every call of `waitForTimeout` (member or bracket form), so `npm run lint` fails on a fixed sleep; tests wait on web-first assertions or `expect.poll` instead, and the rule is never silenced with `eslint-disable`. `src/__tests__/e2eNoFixedSleep.test.ts` lints fixtures through the ESLint Node API and fails if the rule is removed.

`playwright.config.ts` runs one worker, sequentially, with `retries: 0` everywhere (a flaky test fails the run), and forbids `test.only` in CI.

## 5. CI topology

`.github/workflows/ci.yml` defines the `CI` workflow.

- **Triggers.** `push` to `master` or `main`; `pull_request` targeting `master` or `main`; `workflow_dispatch`. The workflow has `contents: read` permission only and uses no secrets.
- **Concurrency.** Group `ci-<pull request number or ref>`; a newer run cancels an in-progress run only for pull requests.
- **Runner.** Every job runs on self-hosted runners labelled `self-hosted, linux, x64, s3-browser`. For pull requests each job (and each e2e shard) runs only when the head repository is this repository and both the PR author and the actor are `n-orlov`; pushes and manual dispatches are not gated. `pull_request_target` is not used.
- **Job `quality`** (20-minute timeout): checkout without persisted credentials, Node 22 with npm cache, `npm ci --no-audit --no-fund`, then `npm run typecheck`, `npm run lint`, `npm run test:coverage`, `npm run crap`, `npm run ratchet:check`, `npm run audit:prod`, `npm run build`, and an always-run upload of `coverage/` as artifact `coverage-report` (7 days).
- **Job `e2e`** (40-minute timeout, matrix `shard: [1, 2]`, `fail-fast: false`, displayed as `e2e shard <i>/2`): checkout without persisted credentials, Node 22, `./scripts/e2e-docker.sh --shard=<i>/2` with `CI=true`, and on failure an upload of `playwright-report/` and `test-results/` as artifact `e2e-report-<i>` (7 days), so each shard uploads under its own name. Each shard runs its own LocalStack and Playwright containers on its own docker network. The `quality` job and both shards have no dependency on each other and run in parallel. `src/__tests__/ciE2eShards.test.ts` fails unless the `e2e` job has exactly the two-shard matrix, passes `--shard`, and names its artifacts per shard.
- **Action pinning.** Every `uses:` in `.github/workflows/ci.yml` and `.github/workflows/release.yml` references a full 40-hex commit SHA followed by a trailing `# <tag>` comment naming the release the SHA resolves to (for an annotated tag, the commit it peels to); Dependabot's `github-actions` entry moves the pins. `src/__tests__/ciActionPins.test.ts` checks both files and fails when a `uses:` ref in either is a tag, branch or short SHA.
- **Dependency updates.** `.github/dependabot.yml` (version 2) has exactly two update entries, `npm` and `github-actions`, each at directory `/` with a `weekly` schedule and a group whose `update-types` are `minor` and `patch`, so minor and patch updates arrive as one grouped pull request per ecosystem and major updates arrive individually. The `npm` entry ignores `typescript` versions `7.x` (with a comment giving the reason): typescript-eslint 8.71.x peers `typescript <6.1.0` and the TypeScript 7 package exports no classic compiler API, so `typescript` stays on 6.0.x until typescript-eslint supports 7. `src/__tests__/dependabotConfig.test.ts` fails when an ecosystem, the weekly interval, the grouping or the typescript 7 ignore is missing.
- **Release.** Packaging and release run from `.github/workflows/release.yml` on GitHub-hosted runners, separately from this workflow.
