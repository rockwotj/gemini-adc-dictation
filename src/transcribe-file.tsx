import { Action, ActionPanel, Form, showToast, Toast } from "@raycast/api";
import { useState } from "react";
import { friendlyError } from "./lib/gemini";
import { finish, store } from "./lib/runtime";
export default function Command() {
  const [busy, setBusy] = useState(false);
  async function submit(values: { audio: string[] }) {
    if (!values.audio?.[0]) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Choose an audio file",
      });
      return;
    }
    setBusy(true);
    try {
      await store.withLock(async () => {
        const session = await store.create(values.audio[0]);
        await finish(session, false);
      });
    } catch (e) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Could not transcribe audio",
        message: friendlyError(e),
      });
    } finally {
      setBusy(false);
    }
  }
  return (
    <Form
      isLoading={busy}
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Transcribe and Copy" onSubmit={submit} />
        </ActionPanel>
      }
    >
      <Form.Description text="Transcribe an audio file with your Gemini model and ADC credentials. The transcript is copied to the clipboard and saved to History." />
      <Form.FilePicker
        id="audio"
        title="Audio File"
        allowMultipleSelection={false}
        canChooseDirectories={false}
      />
      <Form.Description text="WAV, MP3, M4A, MP4, AAC, FLAC, OGG, or WebM · maximum 14 MiB. Your original file is kept." />
    </Form>
  );
}
