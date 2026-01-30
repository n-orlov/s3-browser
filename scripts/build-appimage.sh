#!/bin/bash
# Build AppImage for S3 Browser
# Requires: mksquashfs

set -e

cd "$(dirname "$0")/.."

echo "Building release binary..."
cargo build --release

echo "Copying binary to AppDir..."
mkdir -p appimage/AppDir/usr/bin
cp target/release/s3-browser appimage/AppDir/usr/bin/

echo "Downloading AppImage runtime..."
if [ ! -f runtime-x86_64 ]; then
    curl -L -o runtime-x86_64 "https://github.com/AppImage/AppImageKit/releases/download/continuous/runtime-x86_64"
    chmod +x runtime-x86_64
fi

echo "Creating squashfs..."
# Download appimagetool for mksquashfs if needed
if [ ! -f appimagetool-extracted/usr/lib/appimagekit/mksquashfs ]; then
    curl -L -o appimagetool.AppImage "https://github.com/AppImage/AppImageKit/releases/download/continuous/appimagetool-x86_64.AppImage"
    chmod +x appimagetool.AppImage
    ./appimagetool.AppImage --appimage-extract
    mv squashfs-root appimagetool-extracted
    rm appimagetool.AppImage
fi

./appimagetool-extracted/usr/lib/appimagekit/mksquashfs appimage/AppDir/ appimage.squashfs -root-owned -noappend -comp gzip

echo "Creating AppImage..."
cat runtime-x86_64 appimage.squashfs > dist/S3-Browser-x86_64.AppImage
chmod +x dist/S3-Browser-x86_64.AppImage

echo "Cleaning up..."
rm -f appimage.squashfs

echo "Done! AppImage created at dist/S3-Browser-x86_64.AppImage"
ls -lh dist/S3-Browser-x86_64.AppImage
