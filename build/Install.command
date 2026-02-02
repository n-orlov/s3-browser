#!/bin/bash
# Double-click this file to install S3 Browser

APP_NAME="S3 Browser.app"
DMG_APP="/Volumes/S3 Browser/$APP_NAME"
DEST="/Applications/$APP_NAME"

echo "Installing S3 Browser..."

# Remove old version if exists
if [ -d "$DEST" ]; then
    echo "Removing old version..."
    rm -rf "$DEST"
fi

# Copy app to Applications
echo "Copying to Applications..."
cp -R "$DMG_APP" /Applications/

# Remove quarantine attribute
echo "Removing quarantine flag..."
xattr -cr "$DEST"

echo ""
echo "✓ Installation complete!"
echo ""
echo "You can now open S3 Browser from Applications."
echo ""

# Open the app
open "$DEST"
