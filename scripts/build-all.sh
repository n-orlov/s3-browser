#!/bin/bash
# Build for all platforms using Docker
# This script uses the official electron-builder Docker image with Wine pre-installed
# to create installers for Windows, macOS, and Linux.
#
# Note: macOS code signing requires a macOS machine with valid certificates.
# This script will create unsigned macOS builds.
#
# This script handles both:
# 1. Direct Docker usage (volume mounts work)
# 2. Docker-in-Docker (uses docker cp for file transfer)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo "=== S3 Browser Multi-Platform Build (Docker) ==="
echo "Project directory: $PROJECT_DIR"

# Check if Docker is available
if ! command -v docker &> /dev/null; then
    echo "Error: Docker is not installed or not in PATH"
    exit 1
fi

# Create release directory if it doesn't exist
mkdir -p "$PROJECT_DIR/release"

# Test if volume mounts work (Docker-in-Docker may not support them)
VOLUME_TEST_FILE=$(mktemp)
echo "test" > "$VOLUME_TEST_FILE"
VOLUME_WORKS=$(docker run --rm -v "$VOLUME_TEST_FILE:/test" alpine cat /test 2>/dev/null || echo "")
rm -f "$VOLUME_TEST_FILE"

if [ "$VOLUME_WORKS" = "test" ]; then
    echo "Using volume mount approach..."
    echo ""
    echo "Building for all platforms using Docker..."
    echo "This may take a while on first run (downloading image and building)..."
    echo ""

    docker run --rm \
        -v "$PROJECT_DIR:/project" \
        -v ~/.cache/electron:/root/.cache/electron \
        -v ~/.cache/electron-builder:/root/.cache/electron-builder \
        -w /project \
        electronuserland/builder:wine \
        /bin/bash -c "npm ci && npm run build && electron-builder --win --linux"
else
    echo "Volume mounts not available (Docker-in-Docker detected)"
    echo "Using docker cp approach..."
    echo ""

    CONTAINER_NAME="s3-browser-build-all-$$"

    # Create container
    echo "Creating build container..."
    docker create --name "$CONTAINER_NAME" -w /project electronuserland/builder:wine \
        /bin/bash -c "npm ci && npm run build && electron-builder --win --linux"

    # Copy project files to container (excluding node_modules and release)
    echo "Copying project files to container..."
    cd "$PROJECT_DIR"
    tar --exclude='node_modules' --exclude='release' --exclude='.git' -cf - . | \
        docker cp - "$CONTAINER_NAME:/project"

    # Start the container and wait for it to complete
    echo ""
    echo "Building for Windows and Linux..."
    echo "This may take several minutes..."
    echo ""

    docker start -a "$CONTAINER_NAME"

    # Copy release artifacts back
    echo ""
    echo "Copying release artifacts..."
    docker cp "$CONTAINER_NAME:/project/release/." "$PROJECT_DIR/release/" 2>/dev/null || true

    # Clean up container
    docker rm "$CONTAINER_NAME" >/dev/null 2>&1 || true
fi

echo ""
echo "=== Build Complete ==="
echo "Build artifacts are in: $PROJECT_DIR/release/"
ls -la "$PROJECT_DIR/release/" 2>/dev/null || echo "(release directory may be empty if build failed)"
