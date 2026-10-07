import {
  Clipboard,
  closeMainWindow,
  environment,
  getFrontmostApplication,
  getPreferenceValues,
  showHUD,
} from "@raycast/api";
import { rm } from "node:fs/promises";
import { Settings, transcribe, friendlyError } from "./gemini";
import { Store, Session } from "./store";
export const store = new Store(environment.supportPath);
export const settings = () => getPreferenceValues<Settings>();
export async function capturePasteTarget() {
  await closeMainWindow();
  // Capture after the launcher closes so its own app is never the target.
  // Allow the macOS focus handoff to settle before querying the frontmost app.
  await new Promise((resolve) => setTimeout(resolve, 150));
  const app = await getFrontmostApplication().catch(() => undefined);
  if (
    app?.bundleId === "com.raycast.macos" ||
    app?.bundleId === "ai.local.gemini-adc-dictation.recorder"
  )
    return undefined;
  return app?.bundleId;
}
export async function finish(session: Session, paste: boolean) {
  let result;
  try {
    result = await transcribe(session.audio, settings());
    session.status = "done";
    session.text = result.text;
    session.model = result.model;
    delete session.error;
    // Persist the transcript before deleting audio or attempting insertion.
    await store.save(session);
  } catch (e) {
    session.status = "failed";
    session.error = friendlyError(e);
    await store.save(session);
    throw new Error(session.error);
  }
  if (session.ownedAudio)
    await rm(session.audio, { force: true }).catch(() => undefined);
  if (!result.text) {
    await showHUD("No intelligible speech found");
    return;
  }
  await Clipboard.copy(result.text);
  if (paste && settings().autoPaste !== false && session.target) {
    const front = await capturePasteTarget();
    if (front === session.target) {
      try {
        await Clipboard.paste(result.text);
        return;
      } catch {
        /* Transcript was already copied and persisted. */
      }
    }
  }
  await showHUD("Transcript copied — press ⌘V to paste");
}
