# Gemini ADC Dictation for Raycast

Record your microphone, transcribe through Gemini on Vertex AI using Application Default Credentials, and paste into the app you’re using when you stop dictation.

## Use

Build and import the extension using the instructions below. In **Raycast Settings → Extensions → Gemini ADC Dictation**, assign your preferred hotkey to **Toggle Gemini Dictation**. No hotkey is assigned automatically.

1. Put your cursor where you want to dictate.
2. Press the hotkey once. Wait for the recording indicator, then speak.
3. Press it again to stop and transcribe.
4. The transcript is automatically pasted into the app active when you stop dictation. If you switch apps while transcription is running, it is copied; press ⌘V wherever you want it.

On the first recording, allow **Gemini Recorder** to use the microphone. Pasting requires **Raycast** Accessibility permission in System Settings → Privacy & Security → Accessibility. The recorder is a small, locally compiled, ad-hoc-signed macOS app, with a floating recording indicator and menu bar controls. The glass indicator shows recording status without a second Raycast recording popup. It records only after the command starts it.

This uses press-once/press-again dictation. Raycast command hotkeys do not provide Jot’s hold-and-release gesture. Recording stops automatically after five minutes (configurable up to 300 seconds); run Toggle again to transcribe that clip. The menu bar’s **Stop and Transcribe** also finishes a recording. **Cancel Gemini Dictation** stops and discards the active recording.

Other commands:

- **Check Gemini ADC Setup** authenticates and transcribes a bundled five-second synthetic speech clip to verify project, endpoint, model access, and audio handling. It does not access your microphone.
- **Gemini Transcription History** searches/copies transcripts, retries failed recordings, shows audio in Finder, and deletes local entries.
- **Transcribe Audio File with Gemini** transcribes WAV, MP3, M4A, MP4, AAC, FLAC, OGG, and WebM files, up to 14 MiB. It copies the result and preserves the original file.

## Credentials and preferences

No API key is required. The Google authentication library discovers ADC, refreshes tokens, and authenticates requests directly to `aiplatform.googleapis.com` (or a selected regional Vertex AI endpoint).

A five-second synthetic speech clip was successfully transcribed using existing ADC, the `global` endpoint, and `gemini-3.5-transcribe-preview`. The extension does not contain credentials or a hard-coded project; it discovers your project from your own ADC configuration or extension preferences.

To configure ADC, if needed:

```sh
gcloud auth application-default login
gcloud auth application-default set-quota-project YOUR_PROJECT_ID
```

The project needs billing enabled, the Vertex AI API enabled, and an identity with permission to invoke Gemini (usually Vertex AI User) and use the ADC quota project. This extension does not change IAM, billing, APIs, or your gcloud configuration.

Preferences include:

- **Google Cloud Project**: explicit override; otherwise use the process environment, the Google authentication library’s project discovery, or the ADC quota project. GUI apps may not inherit terminal environment variables; preferences work independently of them.
- **ADC File**: optional explicit credential file if you use a nonstandard location. Normal gcloud ADC is discovered automatically, including `CLOUDSDK_CONFIG` when available to Raycast.
- **Vertex AI Location**: defaults to `global`; change to a supported region if needed.
- **Gemini Transcription Model**: defaults to `gemini-3.5-transcribe-preview`, the verified accessible model in the current transcription family. Google documents the GA model `gemini-3.5-transcribe`, but that name returned HTTP 404 (not found or project access unavailable) in the development project on October 7, 2026. Model access may differ by project; select the GA name explicitly when available. There is no silent model fallback. Any initially imported `gemini-2.5-flash` preference is migrated to the specialist preview.
- **Transcription Style**: clean dictation selects native `SMART` mode; verbatim selects native `VERBATIM` mode. Smart transcription removes disfluencies, resolves explicit spoken self-corrections, and formats text.
- **Custom Vocabulary**: comma-separated names and terms to help with spelling.
- **Insertion**: turn off automatic pasting to always copy instead.
- **Recording Limit**: 5–300 seconds.

This extension uses the Gemini 3.5 specialist transcription model on Vertex AI with ADC and native `audioTranscriptionConfig`. Requests contain audio and transcription settings, without a system prompt, thinking configuration, or a general-purpose model. Smart mode omits timestamps and diarization because those options are incompatible. The `-live` model uses a different WebSocket protocol; this extension submits completed recordings. It does not reproduce Jot’s live transcription, clipboard restoration, or crash recovery features.

## Local data and failure handling

Recordings are mono 16-bit WAV at 16 kHz. Empty, invalid, unfinalized, and digitally silent WAV files are rejected before upload. Requests have a two-minute timeout and do not automatically retry. Truncated or blocked model responses are rejected rather than pasted.

Audio and transcripts live under Raycast’s extension support directory. Session directories use owner-only permissions; metadata and audio files use mode `0600`. Completed audio is deleted only after the transcript is saved. Failed/pending audio is retained until you retry or delete its History entry. History has no automatic retention cutoff: delete local entries when you no longer need them. Imported audio remains at its original path; the extension never deletes the original file.

Audio goes directly to Google for transcription; no middleman service, analytics, API key storage, or background uploads are included. **Check Setup** transcribes the bundled synthetic speech clip, and transcription sends the selected audio and custom vocabulary, using your project’s normal Gemini billing. Model output and request bodies are not logged by the extension.

If transcription fails, open History and select **Transcribe Recording**. Retry copies the result without automatically inserting an older recording. If the recorder crashes, finalized audio can be retried; an unfinalized WAV needs external repair. An interrupted Raycast operation releases its stale lock after ten minutes; the native microphone recording still stops at the configured limit.

Auto-paste captures the app after Raycast closes when you stop recording, then checks that app’s bundle identifier immediately before insertion. A focus change to a different app during transcription causes clipboard fallback. This does not identify a document or field, so changing fields/windows within the same app may change the insertion target. Clipboard content is replaced with the transcript; the extension does not restore a previous clipboard.

## Build and import from source

Requires macOS 14+, Node.js 22.14+, and Xcode command-line tools for Swift compilation.

```sh
git clone https://github.com/rockwotj/gemini-adc-dictation.git
cd gemini-adc-dictation
npm ci
npm run dev
```

`npm run dev` compiles/signs the native helper and imports the extension into Raycast. Once it says the build succeeded, stop the watcher with Ctrl-C; the extension remains available. Restart it to incorporate source changes. Rebuilding changed native code may require granting microphone permission again.

```sh
npm run typecheck
npm test
npm run build
```

Raycast’s full `npm run lint` also checks whether `author` is a registered Store account. The manifest uses the local placeholder `rockwood`, which was not found in the Store. This only affects Store author validation; the build and local import work. Before submitting to the Raycast Store, replace that field with your own registered Raycast Store handle. To check source lint independently, run `npx eslint src`.

For a local installer:

```sh
./node_modules/.bin/ray bundle -o ../gemini-adc-dictation.rayext
```

The bundled recorder is built for the Mac’s current architecture. The source repository excludes compiled native binaries; building on an Intel Mac produces an Intel recorder, and building on an Apple silicon Mac produces an arm64 recorder.

## Indicator preview

The rounded glass recording indicator can be previewed without microphone access:

```sh
npm run build:native
open -n -g "assets/Gemini Recorder.app" --args --preview-indicator
```

The preview exits after 45 seconds. Its material uses an explicit rounded alpha mask, and its contents are clipped to the same corners.

## Verification performed

- Raycast production build and development import.
- TypeScript type checking, ESLint source checks, and Prettier formatting checks.
- Eleven tests covering empty/silent/incomplete WAVs, rejected partial/blocked responses, exclusion of model reasoning, structured transcription parsing, native transcription options, specialist model selection, supported formats and recording limits, error reporting, recorder error recovery, concurrent operation exclusion, failure recovery, owner-only metadata permissions, and preservation of imported audio.
- Native Swift compilation, macOS code signature verification, WAV decoding, launch/cancellation without microphone access, and visual inspection of the rounded indicator preview.
- Live ADC/Vertex AI transcription of verified synthetic speech, with an exact transcript match.

Live microphone capture and insertion into your applications require the first-use macOS permissions and a manual dictation trial.

## References

- [Jot](https://github.com/google-gemini/jot-gemini-transcribe-macOS), the workflow inspiration. No Jot source code is copied into this extension.
- [Google ADC authentication](https://cloud.google.com/docs/authentication/application-default-credentials).
- [Gemini 3.5 Transcribe on Vertex AI](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/gemini/3-5-transcribe).
- [Raycast extension lifecycle](https://developers.raycast.com/information/lifecycle).
