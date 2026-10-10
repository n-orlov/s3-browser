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

| Channel | Arguments | Returns |
| --- | --- | --- |
| `aws:get-profiles` | none | `CredentialsState`: `{ profiles: ProfileInfo[]; currentProfile: string \| null; defaultRegion?: string }` |
| `aws:set-profile` | `profileName: string` | `{ success: boolean; error?: string }`; fails for an unknown or invalid profile |
| `aws:get-current-profile` | none | `string \| null` |
| `aws:get-profile-details` | `profileName: string` | profile details with credentials masked, or `null` for an unknown profile |
| `aws:refresh-profiles` | none | `CredentialsState`, re-read from disk; clears the current profile if it no longer exists |

### 2.2 App state

| Channel | Arguments | Returns |
| --- | --- | --- |
| `app-state:load` | none | `AppStateData`: `{ lastProfile: string \| null; lastBucket: string \| null; lastPrefix: string }` |
| `app-state:save` | `data: Partial<AppStateData>` | `{ success: boolean; error?: string }` |

### 2.3 S3

| Channel | Arguments | Returns |
| --- | --- | --- |
| `s3:list-buckets` | none | `{ success; buckets?: S3Bucket[]; error? }` |
| `s3:list-objects` | `options: ListObjectsOptions` (`bucket`, `prefix?`, `delimiter?`, `maxKeys?`, `continuationToken?`) | `{ success; result?: ListObjectsResult; error? }` |
| `s3:list-all-objects` | `options: Omit<ListObjectsOptions, 'continuationToken'>`, `operationId: string` | `{ success; result?: ListObjectsResult; error? }`; cancellable through `operationId` |
| `s3:cancel-operation` | `operationId: string` | `boolean`, `true` when a running operation was aborted |
| `s3:parse-url` | `url: string` | `{ success; bucket?; key?; error? }` |
| `s3:get-parent-prefix` | `keyOrPrefix: string` | `string` |
| `s3:get-key-name` | `keyOrPrefix: string` | `string` |
| `s3:clear-client` | none | `void`; drops the cached S3 client |
| `s3:download-file` | `bucket: string`, `key: string`, `operationId: string` | `FileOperationResult & { localPath?: string }`; writes into the user's downloads folder, adding ` (n)` before the extension when the name exists |
| `s3:upload-file` | `bucket: string`, `prefix: string`, `filePath: string`, `operationId: string` | `FileOperationResult` |
| `s3:upload-files` | `bucket: string`, `prefix: string`, `filePaths: string[]`, `operationId: string` | `{ success; results: { path; success; error? }[] }`; no top-level `error` (see section 3, Errors) |
| `s3:delete-file` | `bucket: string`, `key: string` | `FileOperationResult` |
| `s3:delete-files` | `bucket: string`, `keys: string[]` | `DeleteFilesResult`: `{ success; results: { key; success; error? }[]; deletedCount; failedCount }`; no top-level `error` (see section 3, Errors) |
| `s3:delete-prefix` | `bucket: string`, `prefix: string` | `DeletePrefixResult`: `{ success; deletedCount; failedCount; error? }` |
| `s3:rename-file` | `bucket: string`, `sourceKey: string`, `newName: string` | `FileOperationResult`; copies to the same parent prefix under the new name, then deletes the source |
| `s3:copy-file` | `sourceBucket: string`, `sourceKey: string`, `destinationBucket: string`, `destinationKey: string` | `FileOperationResult` |
| `s3:upload-content` | `bucket: string`, `key: string`, `content: string` | `FileOperationResult`; gzip-compresses the content when the key ends in `.gz` |
| `s3:download-content` | `bucket: string`, `key: string` | `{ success; content?: string; error? }`; gunzips keys ending in `.gz` |
| `s3:get-file-size` | `bucket: string`, `key: string` | `{ success; size?: number; error? }` |
| `s3:download-binary-content` | `bucket: string`, `key: string` | `{ success; data?: Uint8Array; error? }` |
| `s3:show-open-dialog` | none | `string[] \| null`; native multi-file open dialog, `null` when cancelled |
| `s3:open-downloads-folder` | none | `void`; opens the downloads folder in the system file manager |
| `s3:show-file-in-folder` | `filePath: string` | `void`; reveals the file in the system file manager |
| `s3:get-object-metadata` | `bucket: string`, `key: string` | `{ success; metadata?: ObjectMetadata; error? }` |
| `s3:create-file` | `bucket: string`, `key: string` | `FileOperationResult`; creates an empty object |
| `s3:create-folder` | `bucket: string`, `prefix: string` | `FileOperationResult`; creates a zero-byte folder marker object |

## 3. Security model

The following is what the code implements; behaviour that is absent is stated as absent.

- **Window isolation.** The `BrowserWindow` is created with `contextIsolation: true`, `nodeIntegration: false` and `sandbox: true`. The renderer cannot `require` Node modules; its only bridge is the `electronAPI` object built in the preload script.
- **Content Security Policy.** `src/renderer/index.html` sets `default-src 'self'; script-src 'self' https://cdn.jsdelivr.net blob:; style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; img-src 'self' blob:; worker-src blob:; font-src 'self' https://cdn.jsdelivr.net;`. The jsdelivr origin serves the Monaco editor assets.
- **Credentials.** AWS credentials are read in the main process from the standard AWS shared config and credentials files and never cross the IPC boundary in clear text. `aws:get-profile-details` masks the access key (first and last four characters), replaces the secret key and session token with `********` and the credential process with `(configured)`. `getCurrentProfileCredentials` is internal to the main process.
- **External links.** `setWindowOpenHandler` denies every new window and passes the requested URL to `shell.openExternal`. The handler does not filter by URL scheme.
- **Navigation.** No `will-navigate` or `will-redirect` handler is installed.
- **IPC input.** Handlers type their parameters with TypeScript only; they do not validate the shape of arguments at runtime.
- **Errors.** Every `s3:*` handler whose result has a `success` field catches errors thrown by the AWS SDK or the file system and returns `{ success: false, error }` (for `s3:delete-prefix`, together with `deletedCount: 0, failedCount: 1`), except two that return no `error`: `s3:upload-files` reports per-file failures in `results[].error`, and an error escaping the loop yields `{ success: false, results: [] }`, dropping the results already collected; `s3:delete-files` reports per-key failures in `results[].error`, and an error escaping the loop yields `{ success: false, results: [], deletedCount: 0, failedCount: keys.length }`. `app-state:save` returns `{ success: false, error }` when the state file cannot be written. The `aws:*` handlers, `app-state:load`, `s3:cancel-operation`, `s3:get-parent-prefix`, `s3:get-key-name`, `s3:clear-client`, `s3:show-open-dialog`, `s3:open-downloads-folder` and `s3:show-file-in-folder` have no handler-level catch; an error that reaches them rejects the renderer's `invoke` promise.
- **Downloads.** `s3:download-file` writes into the downloads folder using the final path segment of the key as the file name.
- **Single instance.** A second application instance quits immediately.

## 4. Quality gates

All gates run locally with the `package.json` scripts; CI runs the same commands.

| Script | Command | Gate |
| --- | --- | --- |
| `typecheck` | `tsc -p tsconfig.typecheck.json` | Type-checks `src`, `e2e` and the config files, tests included. |
| `lint` | `eslint . --max-warnings 18` | ESLint; the warning count may only go down. |
| `test:coverage` | `vitest run --coverage` | Unit tests (jsdom) with V8 coverage; thresholds in `vitest.config.ts` are lines 80, functions 78, branches 70, statements 78. `src/main/index.ts` and `src/preload/index.ts` are excluded from coverage. |
| `audit:prod` | `npm audit --omit=dev --audit-level=high` | Fails on a high or critical advisory in production dependencies. |
| `build` | `build:renderer`, `build:main`, `build:preload` | Produces `dist/`. |
| `test:e2e:docker` | `./scripts/e2e-docker.sh` | Runs the Playwright Electron suite in `e2e/` against LocalStack, entirely in containers: a LocalStack container plus a Playwright-image container that runs `npm ci`, `npm run build` and `xvfb-run npx playwright test`. Container, network and run names carry `GITHUB_RUN_ID`, `GITHUB_RUN_ATTEMPT` and the shell pid so concurrent runs do not collide. |

`playwright.config.ts` runs one worker, sequentially, with `retries: 2` when `CI` is set and `0` otherwise, and forbids `test.only` in CI.

## 5. CI topology

`.github/workflows/ci.yml` defines the `CI` workflow.

- **Triggers.** `push` to `master` or `main`; `pull_request` targeting `master` or `main`; `workflow_dispatch`. The workflow has `contents: read` permission only and uses no secrets.
- **Concurrency.** Group `ci-<pull request number or ref>`; a newer run cancels an in-progress run only for pull requests.
- **Runner.** Both jobs run on self-hosted runners labelled `self-hosted, linux, x64, s3-browser`. For pull requests each job runs only when the head repository is this repository and both the PR author and the actor are `n-orlov`; pushes and manual dispatches are not gated. `pull_request_target` is not used.
- **Job `quality`** (20-minute timeout): checkout without persisted credentials, Node 22 with npm cache, `npm ci --no-audit --no-fund`, then `npm run typecheck`, `npm run lint`, `npm run test:coverage`, `npm run audit:prod`, `npm run build`, and an always-run upload of `coverage/` as artifact `coverage-report` (7 days).
- **Job `e2e`** (40-minute timeout): checkout without persisted credentials, Node 22, `./scripts/e2e-docker.sh` with `CI=true`, and on failure an upload of `playwright-report/` and `test-results/` as artifact `e2e-report` (7 days). The `quality` and `e2e` jobs have no dependency on each other and run in parallel.
- **Release.** Packaging and release run from `.github/workflows/release.yml` on GitHub-hosted runners, separately from this workflow.
