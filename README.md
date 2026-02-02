# S3 Browser

A lightweight desktop application for viewing and managing files in Amazon S3 buckets. Built with Electron, React, and TypeScript.

## Background

This project was created as an alternative to heavier S3 clients like Cyberduck. The key motivations were:

- **Lightweight**: Minimal dependencies, quick startup time
- **Full AWS credential support**: Unlike many GUI tools, this fully supports AWS CLI credential configurations including assume-role profiles, SSO, process credentials, and more
- **Developer-friendly**: Inline text editing with Monaco Editor, specialized viewers for Parquet/CSV/JSON/YAML files

See [CLAUDE.md](CLAUDE.md) for detailed development history and technical decisions.

## Features

- **Explorer-like Interface**: Tree view sidebar for bucket navigation, main panel for file listing with sorting and filtering
- **File Operations**: Upload (including drag-and-drop), download, delete, rename files and folders
- **Multi-select**: Shift+click for range select, Ctrl+click for toggle select, batch delete
- **Inline Text Editor**: Monaco Editor with syntax highlighting for JSON, YAML, CSV, and 30+ file types
- **Specialized Viewers**:
  - Parquet: tabular format with lazy loading for large files
  - CSV: tabular viewer with lazy loading
  - JSON: tree view with collapse/expand and text view modes
  - YAML: syntax-highlighted text view
  - Image: preview PNG, JPG, GIF, WebP, SVG, and other formats
- **Compressed File Support**: View and edit gz-compressed text files (.json.gz, .yaml.gz, etc.) - automatically decompresses for viewing and recompresses on save
- **S3 URL Navigation**: Paste S3 URLs in any format (s3://, virtual-hosted, path-style) to navigate directly
- **AWS Credentials**: Full support for AWS CLI credentials including static keys, assume-role, SSO, process credentials
- **Quick Filters**: Filter buckets (case-insensitive contains) and objects (prefix matching)
- **Status Bar**: Shows item count in current prefix and total size of selected items
- **Properties Dialog**: View detailed file/folder metadata (URL, size, modified date, storage class, tags)
- **State Persistence**: Remembers last profile and location across sessions

## Screenshots

![Main Interface](docs/screenshots/main-interface.png)
*Main interface showing bucket tree and file list (screenshot coming soon)*

## Installation

### Pre-built Releases

Download the latest release for your platform from the [Releases page](https://github.com/n-orlov/s3-browser/releases):

- **Windows**: `S3.Browser.Setup.x.x.x.exe` (installer) or `S3.Browser.x.x.x.exe` (portable)
- **Linux**: `S3.Browser-x.x.x.AppImage`
- **macOS**: Coming soon

### Building from Source

#### Prerequisites

- Node.js 20.x or later
- npm 10.x or later
- Git

#### Steps

```bash
# Clone the repository
git clone https://github.com/n-orlov/s3-browser.git
cd s3-browser

# Install dependencies
npm ci

# Run in development mode
npm run dev

# Build the application
npm run build

# Run the built application
npm start
```

## Packaging

### Linux (AppImage)

```bash
npm run package
```

### Windows

Windows builds require Wine or Docker. The recommended approach is using Docker:

```bash
# Using Docker (recommended - no Wine needed on host)
npm run package:win:docker

# Or using Docker script directly
./scripts/build-windows.sh
```

This uses the `electronuserland/builder:wine` Docker image which has Wine pre-installed.

### All Platforms (with Docker)

```bash
npm run package:all:docker
```

Build artifacts are placed in the `release/` directory.

## Development

For detailed development history, architecture decisions, common issues, and lessons learned, see [CLAUDE.md](CLAUDE.md).

### Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start development server with hot reload |
| `npm run build` | Build the application for production |
| `npm test` | Run unit tests |
| `npm run test:watch` | Run tests in watch mode |
| `npm run test:coverage` | Run tests with coverage report |

### Project Structure

```
src/
  main/           # Electron main process
  preload/        # Preload scripts (IPC bridge)
  renderer/       # React frontend
    components/   # React components
    hooks/        # Custom React hooks
    services/     # Business logic (S3, credentials)
    context/      # React contexts
  shared/         # Shared types and utilities
  __tests__/      # Unit and integration tests
```

### Testing

The project uses Vitest for testing with React Testing Library. Run tests with:

```bash
npm test
```

The test suite includes unit tests for:
- AWS credential parsing and profile detection
- S3 service operations (mocked)
- URL parsing for various S3 URL formats
- React components
- Integration tests for S3 operations with real credentials

## AWS Credentials

S3 Browser uses the AWS SDK credential provider chain and supports:

- Static access keys (`aws_access_key_id` / `aws_secret_access_key`)
- Assume role (`role_arn` / `source_profile`)
- SSO (`sso_start_url` / `sso_account_id`)
- Process credentials (`credential_process`)
- Web identity (`web_identity_token_file`)
- Environment variables
- EC2/ECS instance roles

Configure profiles in `~/.aws/credentials` and/or `~/.aws/config`.

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Code Style

- TypeScript with strict mode
- React functional components with hooks
- Tests required for new features

## License

MIT License - see [LICENSE](LICENSE) file for details.

## Author

Nikolai Orlov

## Acknowledgments

- [Monaco Editor](https://microsoft.github.io/monaco-editor/) for the text editor
- [hyparquet](https://github.com/hyparam/hyparquet) for parquet file parsing
- [Electron](https://www.electronjs.org/) for the desktop framework
- [React](https://react.dev/) for the UI framework
