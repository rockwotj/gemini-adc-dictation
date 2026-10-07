import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store, readJSON } from "../src/lib/store";
import { stopRecording } from "../src/lib/recording";

test("recorder errors are terminal so cancel and the next recording can recover", async () => {
  const root = await mkdtemp(join(tmpdir(), "gemini-recorder-test-"));
  const store = new Store(root);
  try {
    const session = await store.create();
    await writeFile(
      join(store.dir(session.id), "recorder.json"),
      JSON.stringify({ status: "error", pid: 0, error: "input unavailable" }),
    );
    assert.equal((await stopRecording(store, session)).status, "error");
    assert.equal(
      (await stopRecording(store, session, true)).error,
      "input unavailable",
    );
    await writeFile(
      join(store.dir(session.id), "recorder.json"),
      JSON.stringify({ status: "stopped", pid: 0 }),
    );
    assert.equal((await stopRecording(store, session)).status, "stopped");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
import {
  extractTranscript,
  friendlyError,
  mimeType,
  recordingLimit,
  transcriptionRequest,
  selectedModel,
  DEFAULT_MODEL,
  validateAudio,
} from "../src/lib/gemini";

test("empty, unfinalized, and digitally silent WAV files never reach Gemini", () => {
  assert.throws(
    () => validateAudio(Buffer.alloc(78), "audio/wav"),
    /empty or too short/,
  );
  const wav = Buffer.alloc(2044);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(2036, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(16000, 24);
  wav.writeUInt32LE(32000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(2000, 40);
  assert.throws(() => validateAudio(wav, "audio/wav"), /digital silence/);
  wav.writeInt16LE(2000, 44);
  assert.doesNotThrow(() => validateAudio(wav, "audio/wav"));
  wav.writeUInt32LE(3000, 40);
  assert.throws(() => validateAudio(wav, "audio/wav"), /incomplete/);
  wav.writeUInt32LE(0, 40);
  assert.throws(
    () => validateAudio(wav, "audio/wav"),
    /no usable audio frames/,
  );
});

test("blocks truncated, blocked, missing, and unfinished model responses", () => {
  for (const reason of ["MAX_TOKENS", "SAFETY", "RECITATION", undefined]) {
    assert.throws(() =>
      extractTranscript({
        candidates: [
          { finishReason: reason, content: { parts: [{ text: "partial" }] } },
        ],
      }),
    );
  }
  assert.throws(() =>
    extractTranscript({ promptFeedback: { blockReason: "SAFETY" } }),
  );
  assert.throws(() => extractTranscript({}));
});
test("excludes reasoning from the transcript and allows silence", () => {
  assert.equal(
    extractTranscript({
      candidates: [
        {
          finishReason: "STOP",
          content: {
            parts: [{ text: "reasoning", thought: true }, { text: " Hello " }],
          },
        },
      ],
    }),
    "Hello",
  );
  assert.equal(
    extractTranscript({
      candidates: [
        { finishReason: "STOP", content: { parts: [{ text: "" }] } },
      ],
    }),
    "",
  );
});
test("accepts supported audio formats and bounds microphone recording", () => {
  assert.equal(mimeType("clip.M4A"), "audio/mp4");
  assert.throws(() => mimeType("clip.caf"));
  assert.equal(recordingLimit({}), 300);
  for (const maxSeconds of ["0", "301", "NaN", "Infinity"])
    assert.throws(() => recordingLimit({ maxSeconds }));
});
test("specialist request avoids unsupported instructions and conflicting transcription options", () => {
  const smart = transcriptionRequest(Buffer.from("audio"), "audio/wav", {
    vocabulary: "Tyler, Kubernetes, Tyler",
  });
  assert.equal(smart.generationConfig.audioTranscriptionConfig.mode, "SMART");
  assert.deepEqual(
    smart.generationConfig.audioTranscriptionConfig.customVocabulary,
    ["Tyler", "Kubernetes"],
  );
  assert.deepEqual(Object.keys(smart), ["contents", "generationConfig"]);
  assert.deepEqual(Object.keys(smart.generationConfig), [
    "audioTranscriptionConfig",
  ]);
  assert.equal("text" in smart.contents[0].parts[0], false);
  const config = smart.generationConfig.audioTranscriptionConfig;
  assert.equal("wordTimestamp" in config, false);
  assert.equal("diarization" in config, false);
  assert.equal(
    transcriptionRequest(Buffer.alloc(0), "audio/wav", { style: "verbatim" })
      .generationConfig.audioTranscriptionConfig.mode,
    "VERBATIM",
  );
  assert.throws(
    () =>
      transcriptionRequest(Buffer.alloc(0), "audio/wav", {
        vocabulary: Array.from({ length: 1001 }, (_, i) => `term${i}`).join(
          ",",
        ),
      }),
    /1,000/,
  );
});
test("default and previously imported model select the verified specialist; explicit GA remains explicit", () => {
  assert.equal(selectedModel({}), DEFAULT_MODEL);
  assert.equal(selectedModel({ model: "gemini-2.5-flash" }), DEFAULT_MODEL);
  assert.equal(
    selectedModel({ model: "gemini-3.5-transcribe" }),
    "gemini-3.5-transcribe",
  );
});
test("structured transcription text is used without duplicating plain text", () => {
  assert.equal(
    extractTranscript({
      candidates: [
        {
          finishReason: "STOP",
          content: {
            parts: [
              { text: "Hello", audioTranscription: { text: "Hello" } },
              { audioTranscription: { text: " there" } },
            ],
          },
        },
      ],
    }),
    "Hello there",
  );
});
test("API errors do not serialize tokens or audio request data", () => {
  const message = friendlyError({
    response: { status: 403, data: { error: { message: "forbidden" } } },
    config: {
      headers: { Authorization: "secret-token" },
      data: "secret-audio",
    },
  });
  assert.match(message, /Vertex AI denied/);
  assert.doesNotMatch(message, /secret/);
});
test("operation lock excludes concurrent commands and releases after failure", async () => {
  const root = await mkdtemp(join(tmpdir(), "gemini-test-"));
  const store = new Store(root);
  try {
    await store.withLock(async () => {
      await assert.rejects(
        store.withLock(async () => "wrong"),
        /already starting or transcribing/,
      );
    });
    await assert.rejects(
      store.withLock(async () => {
        throw new Error("test failure");
      }),
      /test failure/,
    );
    assert.equal(await store.withLock(async () => "released"), "released");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("failed audio and done transcripts survive reload; deleting imported history keeps original audio", async () => {
  const root = await mkdtemp(join(tmpdir(), "gemini-test-"));
  const original = join(root, "original.wav");
  await writeFile(original, "user audio");
  const store = new Store(join(root, "support"));
  try {
    const session = await store.create(original, "com.example.editor");
    await store.setCurrent(session);
    session.status = "failed";
    session.error = "network down";
    await store.save(session);
    const reloaded = new Store(store.root);
    assert.equal((await reloaded.current())?.error, "network down");
    session.status = "done";
    session.text = "saved transcript";
    delete session.error;
    await reloaded.save(session);
    await reloaded.setCurrent();
    assert.equal((await reloaded.list())[0].text, "saved transcript");
    assert.equal(await reloaded.current(), undefined);
    assert.equal(
      (await stat(join(reloaded.dir(session.id), "meta.json"))).mode & 0o777,
      0o600,
    );
    await reloaded.remove(session);
    assert.equal(await readFile(original, "utf8"), "user audio");
    assert.equal(await readJSON(join(root, "missing.json")), undefined);
    assert.throws(
      () => reloaded.dir("../../elsewhere"),
      /Invalid recording ID/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
