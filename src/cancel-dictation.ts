import { showHUD, showToast, Toast } from "@raycast/api";
import { stopRecording } from "./lib/recording";
import { store } from "./lib/runtime";
import { friendlyError } from "./lib/gemini";
export default async function Command() {
  try {
    await store.withLock(async () => {
      const current = await store.current();
      if (!current) {
        await showHUD("No active recording");
        return;
      }
      await stopRecording(store, current, true);
      await store.setCurrent();
      await store.remove(current);
      await showHUD("Recording cancelled");
    });
  } catch (e) {
    await showToast({
      style: Toast.Style.Failure,
      title: "Could not cancel recording",
      message: friendlyError(e),
    });
  }
}
