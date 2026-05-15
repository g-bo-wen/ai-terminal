#!/bin/bash

# Exit on error
set -e

VERSION=$(grep -m1 "version" package.json | cut -d '"' -f 4)
echo "🚀 Building ai-terminal v$VERSION for macOS Universal..."

# Build frontend
echo "📦 Building frontend..."
npm run build

# Build Tauri app for multiple architectures
echo "🔨 Building Universal binary for macOS..."
# Build for Apple Silicon (arm64)
rustup target add aarch64-apple-darwin
# Build for Intel (x86_64)
rustup target add x86_64-apple-darwin

# Build both architectures
echo "Building for ARM64..."
npm run tauri build -- --target aarch64-apple-darwin --bundles app
echo "Building for x86_64..."
npm run tauri build -- --target x86_64-apple-darwin --bundles app

# Create universal binary
echo "Creating universal binary..."
mkdir -p src-tauri/target/universal-apple-darwin/release
lipo -create \
  src-tauri/target/aarch64-apple-darwin/release/ai-terminal \
  src-tauri/target/x86_64-apple-darwin/release/ai-terminal \
  -output src-tauri/target/universal-apple-darwin/release/ai-terminal

# Create app bundle with universal binary
echo "Creating universal app bundle..."
APP_PATH="src-tauri/target/universal-apple-darwin/bundle/macos/ai-terminal.app"
mkdir -p "$APP_PATH/Contents/MacOS"
# Copy the universal binary
cp src-tauri/target/universal-apple-darwin/release/ai-terminal "$APP_PATH/Contents/MacOS/"
# Copy app bundle contents from one of the architectures
cp -R src-tauri/target/aarch64-apple-darwin/release/bundle/macos/ai-terminal.app/Contents/Resources "$APP_PATH/Contents/"
cp src-tauri/target/aarch64-apple-darwin/release/bundle/macos/ai-terminal.app/Contents/Info.plist "$APP_PATH/Contents/"

# Sign the application bundle
echo "🔑 Signing application bundle..."
codesign --force --options runtime --sign "$APPLE_DEVELOPER_ID" \
  --entitlements src-tauri/entitlements.plist \
  "$APP_PATH" --deep --timestamp

# Create DMG
echo "📦 Creating DMG installer..."
DMG_PATH="src-tauri/target/universal-apple-darwin/bundle/dmg/ai-terminal-$VERSION.dmg"
mkdir -p "$(dirname "$DMG_PATH")"

# Check if create-dmg is available
if command -v create-dmg &> /dev/null; then
  echo "Using create-dmg for DMG creation..."
  create-dmg \
    --volname "ai-terminal" \
    --volicon "src-tauri/icons/icon.icns" \
    --window-pos 200 120 \
    --window-size 800 400 \
    --icon-size 100 \
    --icon "ai-terminal.app" 200 190 \
    --hide-extension "ai-terminal.app" \
    --app-drop-link 600 185 \
    "$DMG_PATH" \
    "$APP_PATH"
else
  echo "create-dmg not found, using hdiutil..."
  # Create a temporary directory for DMG creation
  TMP_DMG_DIR=$(mktemp -d)
  cp -R "$APP_PATH" "$TMP_DMG_DIR/"
  
  # Create a symlink to Applications folder
  ln -s /Applications "$TMP_DMG_DIR/Applications"
  
  # Create the DMG
  hdiutil create -volname "ai-terminal" -srcfolder "$TMP_DMG_DIR" -ov -format UDZO "$DMG_PATH"
  
  # Clean up
  rm -rf "$TMP_DMG_DIR"
fi

# Sign the DMG
echo "🔑 Signing DMG..."
codesign --force --sign "$APPLE_DEVELOPER_ID" "$DMG_PATH" --timestamp

# Notarize the DMG
echo "📝 Notarizing DMG..."
xcrun notarytool submit "$DMG_PATH" \
  --key "$APPLE_API_KEY" \
  --key-id "$APPLE_API_KEY_ID" \
  --issuer "$APPLE_API_ISSUER" \
  --wait

# Staple the notarization ticket
echo "📎 Stapling notarization ticket to DMG..."
xcrun stapler staple "$DMG_PATH"

# Calculate SHA256 for Homebrew
SHA256=$(shasum -a 256 "$DMG_PATH" | awk '{print $1}')

echo "✅ Build complete! DMG is available at: $DMG_PATH"
echo "✅ SHA256: $SHA256"
