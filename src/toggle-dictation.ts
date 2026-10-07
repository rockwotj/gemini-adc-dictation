import { environment, showHUD, showToast, Toast } from "@raycast/api";
import { join } from "node:path";
import { writeFile } from "node:fs/promises";
import { friendlyError, recordingLimit } from "./lib/gemini";
import { startRecording, stopRecording } from "./lib/recording";
import { capturePasteTarget, finish, settings, store } from "./lib/runtime";

export default async function Command() {
  try {
    await store.withLock(async () => {
      const current = await store.current();
      if (current) {
        // Stopping dictation chooses the insertion target, so moving to a
        // different app while recording still pastes where the user is now.
        current.target = await capturePasteTarget();
        await store.save(current);
        const state = await stopRecording(store, current);
        await store.setCurrent();
        if (state.status === "cancelled") {
          await store.remove(current);
          await showHUD("Recording cancelled");
          return;
        }
        if (state.status === "error") {
          current.status = "failed";
          current.error = state.error || "Recording failed.";
          await store.save(current);
          throw new Error(current.error);
        }
        await showHUD("Transcribing with Gemini…");
        await finish(current, true);
        return;
      }
      const limit = recordingLimit(settings());
      const target = await capturePasteTarget();
      const session = await store.create(undefined, target);
      await store.setCurrent(session);
      try {
        const base = `raycast://extensions/${environment.ownerOrAuthorName}/${environment.extensionName}`;
        await startRecording(
          store,
          session,
          join(environment.assetsPath, "Gemini Recorder.app"),
          limit,
          [`${base}/toggle-dictation`, `${base}/cancel-dictation`],
        );
      } catch (e) {
        await writeFile(join(store.dir(session.id), "cancel"), "", {
          mode: 0o600,
        });
        session.status = "failed";
        session.error = friendlyError(e);
        await store.save(session);
        await store.setCurrent();
        throw e;
      }
    });
  } catch (e) {
    await showToast({
      style: Toast.Style.Failure,
      title: "Gemini Dictation",
      message: friendlyError(e),
    });
  }
}
