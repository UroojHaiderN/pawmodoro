#!/bin/bash
# Builds mac/build/Pawmodoro.app (Apple silicon + Intel) and a zip you can share.
set -euo pipefail
cd "$(dirname "$0")"

APP=build/Pawmodoro.app
rm -rf build
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources/web/icons" build/obj

for arch in arm64 x86_64; do
  swiftc -O -swift-version 5 -parse-as-library -target "$arch-apple-macos13.0" \
    -framework Cocoa -framework WebKit \
    Pawmodoro.swift -o "build/obj/Pawmodoro-$arch"
done
lipo -create build/obj/Pawmodoro-arm64 build/obj/Pawmodoro-x86_64 -output "$APP/Contents/MacOS/Pawmodoro"

cp Info.plist "$APP/Contents/Info.plist"
cp AppIcon.icns "$APP/Contents/Resources/AppIcon.icns"
cp ../index.html ../app.js "$APP/Contents/Resources/web/"
cp ../icons/*.png ../icons/*.svg "$APP/Contents/Resources/web/icons/"

codesign --force --deep --sign - "$APP"
ditto -c -k --keepParent "$APP" build/Pawmodoro-mac.zip
rm -rf build/obj
echo "Built $(pwd)/$APP"
