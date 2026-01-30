#!/bin/bash
# Build Windows executable for S3 Browser (cross-compilation)
# Requires: mingw-w64 toolchain, x86_64-pc-windows-gnu target

set -e

cd "$(dirname "$0")/.."

VERSION="${VERSION:-2.0.0}"
TARGET="x86_64-pc-windows-gnu"

echo "Checking Windows target..."
if ! rustup target list --installed | grep -q "$TARGET"; then
    echo "Installing Windows target..."
    rustup target add "$TARGET"
fi

echo "Checking for mingw-w64..."
if ! command -v x86_64-w64-mingw32-gcc &> /dev/null; then
    echo "Error: mingw-w64 not installed. Install with:"
    echo "  Ubuntu/Debian: apt install gcc-mingw-w64-x86-64"
    echo "  Fedora: dnf install mingw64-gcc"
    exit 1
fi

echo "Building Windows release binary..."
cargo build --release --target "$TARGET"

echo "Creating dist directory..."
mkdir -p dist/windows

echo "Copying binary..."
cp "target/$TARGET/release/s3-browser.exe" dist/windows/

echo "Creating portable zip..."
cd dist/windows
zip -9 "../s3-browser-${VERSION}-windows-x86_64.zip" s3-browser.exe
cd ../..

echo ""
echo "Done! Windows build complete:"
ls -lh "dist/windows/s3-browser.exe"
ls -lh "dist/s3-browser-${VERSION}-windows-x86_64.zip"
echo ""
echo "To copy to workspace root for testing:"
echo "  cp dist/windows/s3-browser.exe /workspace/"
