import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  copyFileSync,
  rmSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
const root = fileURLToPath(new URL("../", import.meta.url));
const source = join(root, "native", "Recorder.swift");
const app = join(root, "assets", "Gemini Recorder.app");
const contents = join(app, "Contents");
const binary = join(contents, "MacOS", "GeminiRecorder");
const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>ai.local.gemini-adc-dictation.recorder</string>
<key>CFBundleExecutable</key><string>GeminiRecorder</string>
<key>CFBundleName</key><string>Gemini Recorder</string>
<key>CFBundleDisplayName</key><string>Gemini Recorder</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleVersion</key><string>1</string>
<key>CFBundleShortVersionString</key><string>1.0</string>
<key>CFBundleIconFile</key><string>RecorderIcon</string>
<key>LSMinimumSystemVersion</key><string>14.0</string>
<key>LSUIElement</key><true/>
<key>NSMicrophoneUsageDescription</key><string>Record your voice for Gemini transcription when you run Toggle Gemini Dictation in Raycast.</string>
</dict></plist>`;
const hash = createHash("sha256")
  .update(readFileSync(source))
  .update(plist)
  .update(process.arch)
  .digest("hex");
const stamp = join(contents, "Resources", "build-hash");
rmSync(join(contents, "build-hash"), { force: true });
if (
  existsSync(binary) &&
  existsSync(stamp) &&
  readFileSync(stamp, "utf8") === hash
) {
  console.log("Native recorder is current.");
  process.exit(0);
}
mkdirSync(dirname(binary), { recursive: true });
mkdirSync(join(contents, "Resources"), { recursive: true });
writeFileSync(join(contents, "Info.plist"), plist);
const cache = join(root, "node_modules", ".cache", "swift");
mkdirSync(cache, { recursive: true });
execFileSync(
  "/usr/bin/xcrun",
  [
    "swiftc",
    "-O",
    "-module-cache-path",
    cache,
    "-target",
    `${process.arch === "arm64" ? "arm64" : "x86_64"}-apple-macos14.0`,
    source,
    "-o",
    binary,
  ],
  { stdio: "inherit" },
);
writeFileSync(stamp, hash);
const icon = join(root, "assets", "recorder-icon.icns");
if (existsSync(icon))
  copyFileSync(icon, join(contents, "Resources", "RecorderIcon.icns"));
execFileSync(
  "/usr/bin/codesign",
  [
    "--force",
    "--sign",
    "-",
    "--identifier",
    "ai.local.gemini-adc-dictation.recorder",
    app,
  ],
  { stdio: "inherit" },
);
console.log(`Built ${process.arch} recorder: ${app}`);
