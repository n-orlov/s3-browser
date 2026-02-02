#!/bin/bash
# Build macOS DMG
#
# This script builds the macOS DMG package.
#
# IMPORTANT: For signed builds, this must run on macOS with:
# - Xcode Command Line Tools installed
# - Valid Apple Developer certificate in Keychain
# - Set CSC_LINK and CSC_KEY_PASSWORD environment variables for code signing
#   OR use -c.mac.identity=null for unsigned builds
#
# For unsigned builds (testing only):
#   ./scripts/build-macos.sh --unsigned
#
# For signed builds:
#   export CSC_LINK=/path/to/certificate.p12
#   export CSC_KEY_PASSWORD=your-password
#   ./scripts/build-macos.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo "=== S3 Browser macOS Build ==="
echo "Project directory: $PROJECT_DIR"

# Check if running on macOS
if [[ "$(uname)" != "Darwin" ]]; then
    echo "Error: macOS builds must run on macOS"
    echo "Note: Unlike Windows/Linux builds, macOS builds cannot be cross-compiled"
    echo "      due to code signing requirements."
    exit 1
fi

# Check for Xcode Command Line Tools
if ! xcode-select -p &> /dev/null; then
    echo "Error: Xcode Command Line Tools are not installed"
    echo "Install with: xcode-select --install"
    exit 1
fi

cd "$PROJECT_DIR"

# Create release directory if it doesn't exist
mkdir -p "$PROJECT_DIR/release"

# Check for unsigned flag
UNSIGNED_FLAG=""
if [[ "$1" == "--unsigned" ]]; then
    echo ""
    echo "Building UNSIGNED DMG (for testing only)"
    echo "Warning: Unsigned apps will trigger Gatekeeper warnings on other Macs"
    echo ""
    UNSIGNED_FLAG="-c.mac.identity=null"
fi

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    echo "Installing dependencies..."
    npm ci
fi

# Build the application
echo ""
echo "Building application..."
npm run build

# Package for macOS
echo ""
echo "Creating macOS DMG..."
npx electron-builder --mac $UNSIGNED_FLAG

echo ""
echo "=== Build Complete ==="
echo "macOS DMG is in: $PROJECT_DIR/release/"
ls -la "$PROJECT_DIR/release/"*.dmg 2>/dev/null || echo "(No DMG file found - build may have failed)"
