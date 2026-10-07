import {
  Action,
  ActionPanel,
  Detail,
  environment,
  Icon,
  openExtensionPreferences,
} from "@raycast/api";
import { useEffect, useState } from "react";
import { access } from "node:fs/promises";
import { join } from "node:path";
import { transcribe, friendlyError, recordingLimit } from "./lib/gemini";
import { settings } from "./lib/runtime";
export default function Command() {
  const [markdown, setMarkdown] = useState(
    "Checking ADC and Gemini model access…",
  );
  const [busy, setBusy] = useState(true);
  async function check() {
    setBusy(true);
    try {
      const config = settings();
      const limit = recordingLimit(config);
      await access(
        join(
          environment.assetsPath,
          "Gemini Recorder.app",
          "Contents",
          "MacOS",
          "GeminiRecorder",
        ),
      );
      const result = await transcribe(
        join(environment.assetsPath, "setup-check.wav"),
        config,
      );
      if (
        !result.text.includes("Gemini dictation") ||
        !result.text.includes("Tyler tomorrow morning")
      )
        throw new Error(
          "The model responded, but did not correctly transcribe the synthetic setup clip.",
        );
      setMarkdown(
        `# Gemini is ready\n\n- ADC authentication: successful\n- Project: \`${result.project}\`\n- Location: \`${result.location}\`\n- Model: \`${result.model}\`\n- Verified sample transcript: ${result.text}\n- Native recorder: installed\n- Recording limit: ${limit} seconds\n\nAssign a hotkey to **Toggle Gemini Dictation** in Raycast Settings → Extensions. Press once to record and again to stop and transcribe.\n\nThe first recording asks for **Gemini Recorder** microphone permission. Auto-paste requires **Raycast** Accessibility permission. This check transcribes a bundled synthetic speech clip; it does not access your microphone.`,
      );
    } catch (e) {
      setMarkdown(
        `# Setup needs attention\n\n${friendlyError(e)}\n\n1. Run \`gcloud auth application-default login\` if you need new ADC credentials.\n2. Set **Google Cloud Project** in this extension’s preferences, or set the ADC quota project with \`gcloud auth application-default set-quota-project PROJECT_ID\`.\n3. The project needs billing, the Vertex AI API enabled, and permission to call Gemini.\n4. Use a Gemini model available in your selected location.\n\nIf the native recorder is missing, run \`npm run build:native\` in the extension folder and reimport it.`,
      );
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void check();
  }, []);
  return (
    <Detail
      isLoading={busy}
      markdown={markdown}
      actions={
        <ActionPanel>
          <Action
            title="Check Again"
            icon={Icon.ArrowClockwise}
            onAction={check}
          />
          <Action
            title="Open Extension Preferences"
            icon={Icon.Gear}
            onAction={openExtensionPreferences}
          />
        </ActionPanel>
      }
    />
  );
}
