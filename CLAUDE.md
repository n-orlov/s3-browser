# Claude Development Context

This file provides context for Claude (or any AI assistant) working on this project. It documents the project history, design decisions, mistakes made, and lessons learned during development.

## Project Background

**Motivation**: The author (Nikolai Orlov) needed a lightweight S3 file browser. Existing solutions like Cyberduck were too heavy and didn't fully support the host's CLI credential configurations (assume-role profiles, SSO, etc.).

**Core Requirements**:
- Explorer-like interface with tree view for buckets/folders
- Full file operations: upload, download, delete, rename with drag-and-drop
- Inline text editor with syntax highlighting (Monaco Editor)
- Specialized viewers for Parquet, CSV, JSON, YAML files
- Image preview for common formats
- Support for gz-compressed text files (decompress for view/edit, recompress on save)
- Lazy loading for large buckets (S3 can have millions of objects)
- S3 URL navigation - paste any S3 URL format to navigate directly
- Full AWS credential support including assume-role, SSO, process credentials
- Quick filters for buckets (contains) and objects (prefix match - S3 API semantics)
- Multi-select with Shift/Ctrl+click for batch operations
- State persistence (remember last profile and location)
- Cross-platform (Windows primary, Linux AppImage, macOS future)

## Development History & Key Milestones

### Phase 1: Core Infrastructure
- Set up Electron + React + TypeScript stack
- Implemented basic S3 listing and navigation
- **Issue encountered**: Initial AWS credential handling only supported static keys

### Phase 2: Credential System Fixes
- **Major issue**: Assume-role profiles showed as "[invalid]"
- Root cause: Was not using full AWS SDK credential provider chain
- **Fix**: Switched to `@aws-sdk/credential-providers` with `fromIni()` that properly handles source_profile, role_arn chains
- **Lesson**: Always use the standard SDK credential chain, don't try to parse credentials manually

### Phase 3: File Viewer Issues
- **Issue**: Text editor showed infinite loading spinner
- **Issue**: Parquet viewer error: "First argument to DataView constructor must be an ArrayBuffer"
- Root cause: Data not being properly converted to ArrayBuffer before passing to viewer
- **Fix**: Ensured proper Buffer-to-ArrayBuffer conversion in the IPC layer
- **Lesson**: Be careful with data type conversions between main process and renderer

### Phase 4: UI/UX Refinements
- Fixed column sizing (name was truncated too aggressively)
- Made size/date columns fixed width, name takes remaining space
- Added "Copy S3 URL" button
- Added stats bar showing item count and selected size
- Added Properties dialog for file metadata
- Added "New File" and "New Folder" buttons
- Converted toolbar to icon-only buttons with tooltips (PrimeIcons)

### Phase 5: Parquet Viewer Fixes
- **Issue**: Empty rows, all columns showed "unknown" type
- Root cause: Incorrect handling of Parquet schema types
- **Fix**: Proper type mapping for all Parquet types (strings, numbers, dates, booleans, nulls, arrays, structs)
- Complex types now JSONified for display

### Phase 6: List Refresh Issues
- **Issue**: List wouldn't refresh after upload and rename
- **Fix**: Added proper refresh calls after mutation operations
- **Lesson**: Always refresh views after state-changing operations

### Phase 7: Native Desktop Feel
- Removed generic menu bar
- Disabled text selection across UI (felt more native)
- Added bucket quick filter (case-insensitive contains)
- Made clear distinction: bucket filter = contains, object filter = prefix (S3 API semantics)

### Phase 8: Packaging
- **Issue**: Wine dependency on Linux host for Windows builds
- **Solution**: Docker-based builds using `electronuserland/builder:wine`
- Scripts: `npm run package:win:docker`, `npm run package:all:docker`

### Phase 9: CI/CD
- Set up GitHub Actions for build and test on push/PR
- Release workflow for creating releases with artifacts (Linux AppImage, Windows NSIS + portable)
- Repository: https://github.com/n-orlov/s3-browser

### Phase 10: Testing
- TDD approach with Vitest + React Testing Library
- Target: 80%+ test coverage (quality gate)
- Integration tests with mocked S3 backend
- E2E tests with Playwright (Electron support)

## Common Issues & Solutions

### AWS Credentials Not Working
- Make sure to use `@aws-sdk/credential-providers` with `fromIni()`
- Support the full credential chain: static, assume-role, SSO, process, web-identity
- Test with real credential files to validate

### S3 URL Navigation
- Support multiple URL formats: s3://, virtual-hosted, path-style
- When navigating to a file URL, scroll to and select that file
- May need to load additional pages to find the file (show progress)

### Large Bucket Performance
- Use lazy loading / infinite scroll
- Show loading progress with cancel option
- Don't load all objects upfront for filtering - use S3 prefix API

### Data Type Conversions (Electron IPC)
- Buffers need explicit conversion to ArrayBuffer for viewers
- Be careful with serialization across process boundaries

## Architecture Notes

```
src/
  main/           # Electron main process - S3 operations, file system access
  preload/        # IPC bridge - exposes safe APIs to renderer
  renderer/       # React frontend
    components/   # UI components (FileList, Viewers, Editor, etc.)
    hooks/        # Custom hooks (useS3, useCredentials, etc.)
    services/     # Business logic
    context/      # React contexts (S3Context, etc.)
  shared/         # Shared types and utilities
  __tests__/      # Tests
```

## Current State & Pending Work

### Completed
- All core features listed in requirements
- File viewers: Text (Monaco), Parquet, CSV, JSON (tree/text), YAML, Image
- Gz-compressed file support
- Multi-select and batch operations
- State persistence
- Docker-based packaging
- CI/CD with GitHub Actions

### In Progress / Pending
- E2E tests with Playwright (using mocked S3 backend like LocalStack)
- Detailed Playwright reports with screenshots and video recordings
- macOS builds

## Testing Philosophy

- Unit tests for core logic (credential parsing, URL parsing, S3 operations)
- Integration tests with mocked S3 backend
- E2E tests with Playwright for UI flows
- Coverage target: 80%+
- Test files located in `src/__tests__/` and `e2e/`

## Package Information

- Namespace: `org.github.n-orlov`
- Author: Nikolai Orlov
- License: MIT
