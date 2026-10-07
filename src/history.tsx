import {
  Action,
  ActionPanel,
  Icon,
  List,
  showToast,
  Toast,
  Keyboard,
} from "@raycast/api";
import { useEffect, useState } from "react";
import { Session } from "./lib/store";
import { store, finish } from "./lib/runtime";
import { recorderState, stopRecording } from "./lib/recording";
import { friendlyError } from "./lib/gemini";

export default function Command() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  async function refresh() {
    try {
      setSessions(await store.list());
    } catch (e) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Could not load history",
        message: friendlyError(e),
      });
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void refresh();
  }, []);
  async function retry(session: Session) {
    setLoading(true);
    try {
      await store.withLock(async () => {
        const current = await store.current();
        const state = session.ownedAudio
          ? await recorderState(store, session)
          : undefined;
        if (state?.status === "recording" || state?.status === "starting")
          await stopRecording(store, session);
        if (current?.id === session.id) await store.setCurrent();
        await finish(session, false);
      });
    } catch (e) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Transcription failed — audio retained",
        message: friendlyError(e),
      });
    } finally {
      await refresh();
    }
  }
  async function remove(session: Session) {
    try {
      await store.withLock(async () => {
        const state = session.ownedAudio
          ? await recorderState(store, session)
          : undefined;
        if (state?.status === "recording" || state?.status === "starting")
          await stopRecording(store, session, true);
        if ((await store.current())?.id === session.id)
          await store.setCurrent();
        await store.remove(session);
      });
      await refresh();
    } catch (e) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Could not delete recording",
        message: friendlyError(e),
      });
    }
  }
  return (
    <List
      isLoading={loading}
      isShowingDetail
      searchBarPlaceholder="Search transcripts"
    >
      <List.EmptyView
        icon={Icon.Microphone}
        title="No transcripts yet"
        description="Run Toggle Gemini Dictation to record, or Transcribe Audio File to select a clip."
      />
      {sessions.map((session) => (
        <List.Item
          key={session.id}
          title={
            session.text?.slice(0, 90) ||
            (session.status === "failed"
              ? "Transcription failed"
              : session.status === "done"
                ? "No speech detected"
                : "Recording / awaiting transcription")
          }
          keywords={[session.text || "", session.error || ""]}
          icon={
            session.status === "done"
              ? Icon.Text
              : session.status === "failed"
                ? Icon.ExclamationMark
                : Icon.Microphone
          }
          accessories={[{ date: new Date(session.created) }]}
          detail={
            <List.Item.Detail
              markdown={
                session.text ||
                session.error ||
                "Audio is stored locally. Use Transcribe Recording to finish or retry."
              }
              metadata={
                <List.Item.Detail.Metadata>
                  <List.Item.Detail.Metadata.Label
                    title="Status"
                    text={session.status}
                  />
                  <List.Item.Detail.Metadata.Label
                    title="Model"
                    text={session.model || "Current preference"}
                  />
                  <List.Item.Detail.Metadata.Label
                    title="Created"
                    text={new Date(session.created).toLocaleString()}
                  />
                </List.Item.Detail.Metadata>
              }
            />
          }
          actions={
            <ActionPanel>
              {session.text ? (
                <>
                  <Action.CopyToClipboard
                    title="Copy Transcript"
                    content={session.text}
                  />
                  <Action.Paste
                    title="Paste Transcript"
                    content={session.text}
                  />
                </>
              ) : session.status !== "done" ? (
                <Action
                  title="Transcribe Recording"
                  icon={Icon.Redo}
                  onAction={() => retry(session)}
                />
              ) : null}
              {session.status !== "done" && (
                <Action.ShowInFinder
                  title="Show Audio in Finder"
                  path={session.audio}
                />
              )}
              <Action
                title="Refresh"
                icon={Icon.ArrowClockwise}
                shortcut={Keyboard.Shortcut.Common.Refresh}
                onAction={refresh}
              />
              <Action
                title="Delete Local Entry"
                style={Action.Style.Destructive}
                icon={Icon.Trash}
                shortcut={{ modifiers: ["ctrl"], key: "x" }}
                onAction={() => remove(session)}
              />
            </ActionPanel>
          }
        />
      ))}
    </List>
  );
}
