# S3 Browser

A lightweight, cross-platform desktop application for viewing and managing files in AWS S3 buckets. Built with Rust and Slint for fast startup and minimal resource usage.

## Features

- **Explorer-like Interface**: Tree view sidebar for bucket navigation, main panel for file listing with sorting and filtering
- **File Operations**: Upload (including drag-and-drop), download, delete, rename files
- **Multi-select**: Shift+click for range select, Ctrl+click for toggle select, batch delete
- **Inline Text Editor**: Syntax highlighting for JSON, YAML, CSV, and text files
- **Parquet Viewer**: View parquet files in tabular format with lazy loading for large files
- **CSV Viewer**: Tabular viewer for CSV files with lazy loading
- **Image Preview**: Preview PNG, JPG, GIF images
- **S3 URL Navigation**: Paste S3 URLs in any format (s3://, virtual-hosted, path-style) to navigate directly
- **AWS Credentials**: Full support for AWS SDK credential chain including profiles, assume-role, SSO, EC2/ECS roles, env vars
- **Quick Filters**: Filter buckets (case-insensitive contains) and objects (prefix matching)
- **State Persistence**: Remembers last profile and location across sessions

## Installation

### Pre-built Releases

Download the latest release for your platform from the [Releases page](https://github.com/n-orlov/s3-browser/releases):

- **Windows**: `s3-browser.exe` (portable) or MSI installer
- **Linux**: AppImage, `.deb`, or `.rpm`
- **macOS**: Coming in future releases

### Building from Source

#### Prerequisites

- Rust 1.75 or later (install via [rustup](https://rustup.rs/))
- System dependencies for GUI:
  - **Linux**: `libgtk-3-dev libwebkit2gtk-4.1-dev` (for webview editor modal)
  - **Windows**: No additional dependencies
  - **macOS**: No additional dependencies

#### Steps

```bash
# Clone the repository
git clone https://github.com/n-orlov/s3-browser.git
cd s3-browser

# Build in debug mode
cargo build

# Build in release mode (optimized)
cargo build --release

# Run the application
cargo run --release
```

## Development

### Project Structure

```
s3-browser/
├── Cargo.toml              # Workspace root with dependencies
├── src/
│   ├── main.rs             # Entry point
│   ├── app.rs              # Application state & logic
│   ├── s3/                 # S3 client wrapper
│   │   ├── mod.rs
│   │   ├── client.rs       # AWS SDK wrapper
│   │   ├── credentials.rs  # Profile management
│   │   └── types.rs        # S3Object, Bucket types
│   ├── viewers/            # File viewers
│   │   ├── mod.rs
│   │   ├── parquet.rs
│   │   ├── csv.rs
│   │   └── text.rs
│   └── ui/                 # Slint UI components
│       ├── mod.rs
│       └── components/
├── ui/                     # Slint markup files
│   ├── main.slint
│   ├── explorer.slint
│   ├── file_list.slint
│   └── dialogs/
├── tests/                  # Integration tests
└── assets/                 # Icons, etc.
```

### Testing

```bash
# Run unit tests
cargo test

# Run with verbose output
cargo test -- --nocapture
```

### Cross-compilation

```bash
# Build for Windows from Linux
cargo build --release --target x86_64-pc-windows-gnu

# Using cross for easier cross-compilation
cross build --release --target x86_64-pc-windows-gnu
```

## AWS Credentials

S3 Browser uses the AWS SDK credential provider chain and supports:

- Static access keys (`aws_access_key_id` / `aws_secret_access_key`)
- Assume role (`role_arn` / `source_profile`)
- SSO (`sso_start_url` / `sso_account_id`)
- Process credentials (`credential_process`)
- Environment variables (`AWS_ACCESS_KEY_ID`, etc.)
- EC2/ECS instance roles

Configure profiles in `~/.aws/credentials` and/or `~/.aws/config`.

## Technology Stack

| Component | Technology |
|-----------|------------|
| Language | Rust |
| UI Framework | Slint |
| Text Editor | Monaco/CodeMirror (webview modal) |
| Async Runtime | tokio |
| AWS SDK | aws-sdk-rust |
| Parquet | Apache Arrow parquet crate |
| CSV | csv crate |

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

MIT License - see [LICENSE](LICENSE) file for details.

## Author

Nikolai Orlov

## Version History

- **v2.0.0**: Complete rewrite in Rust + Slint (current)
- **v1.x**: Electron-based implementation (archived in `v1-electron` branch)
