import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFile, access } from "node:fs/promises";
import { join } from "node:path";
import { readJSON, Session, Store } from "./store";
const exec = promisify(execFile);
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
export interface RecorderState {
  status: "starting" | "recording" | "stopped" | "cancelled" | "error";
  error?: string;
  pid: number;
  duration?: number;
}
export async function recorderState(store: Store, session: Session) {
  return readJSON<RecorderState>(join(store.dir(session.id), "recorder.json"));
}
export async function startRecording(
  store: Store,
  session: Session,
  app: string,
  seconds: number,
  urls: string[] = [],
) {
  await access(join(app, "Contents", "MacOS", "GeminiRecorder"));
  await exec(
    "/usr/bin/open",
    [
      "-n",
      "-g",
      app,
      "--args",
      store.dir(session.id),
      String(seconds),
      ...urls,
    ],
    { timeout: 10_000 },
  );
  // Leave time for the first microphone permission prompt. The stop marker is
  // checked before starting audio, including after permission is granted.
  for (let n = 0; n < 480; n++) {
    const state = await recorderState(store, session);
    if (state?.status === "recording") return;
    if (state?.status === "error")
      throw new Error(state.error || "Microphone unavailable.");
    if (state?.status === "stopped" || state?.status === "cancelled")
      throw new Error("Recording ended before it started.");
    await pause(250);
  }
  await writeFile(join(store.dir(session.id), "cancel"), "", { mode: 0o600 });
  throw new Error(
    "Microphone permission timed out. Allow Gemini Recorder in System Settings → Privacy & Security → Microphone, then try again.",
  );
}
export async function stopRecording(
  store: Store,
  session: Session,
  cancel = false,
) {
  await writeFile(join(store.dir(session.id), cancel ? "cancel" : "stop"), "", {
    mode: 0o600,
  });
  for (let n = 0; n < 100; n++) {
    const state = await recorderState(store, session);
    if (state?.status === "stopped" || state?.status === "cancelled")
      return state;
    // The helper stops its microphone before publishing error. Treat that as
    // terminal so cancellation and a new recording cannot be wedged by it.
    if (state?.status === "error") return state;
    if (state?.pid) {
      try {
        process.kill(state.pid, 0);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
        return {
          ...state,
          status: "error" as const,
          error:
            "Recorder exited unexpectedly. Audio remains in History; try transcribing it there.",
        };
      }
    }
    await pause(100);
  }
  throw new Error(
    "Recorder has not confirmed that the microphone stopped. Try Cancel Dictation or quit Gemini Recorder from its menu bar icon.",
  );
}
