import { GoogleAuth } from "google-auth-library";
import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, extname } from "node:path";

export interface Settings {
  project?: string;
  location?: string;
  model?: string;
  credentialsFile?: string;
  style?: string;
  vocabulary?: string;
  autoPaste?: boolean;
  maxSeconds?: string;
}
export const MAX_AUDIO_BYTES = 14 * 1024 * 1024;
export const DEFAULT_MODEL = "gemini-3.5-transcribe-preview";
export function selectedModel(settings: Settings) {
  const model = settings.model?.trim();
  // Migrate the initially imported general-purpose default to the specialist
  // requested by the user. Never fall back after an API failure.
  return !model || model === "gemini-2.5-flash" ? DEFAULT_MODEL : model;
}
export function validateAudio(audio: Buffer, mime: string) {
  if (audio.length < 1024)
    throw new Error("Audio is empty or too short. Record a little longer.");
  if (mime !== "audio/wav") return;
  if (
    audio.toString("ascii", 0, 4) !== "RIFF" ||
    audio.toString("ascii", 8, 12) !== "WAVE"
  ) {
    throw new Error("This WAV file has an invalid header.");
  }
  let dataBytes = 0;
  let format = 0;
  let bits = 0;
  let nonzero = false;
  for (let offset = 12; offset + 8 <= audio.length;) {
    const chunk = audio.toString("ascii", offset, offset + 4);
    const size = audio.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (start + size > audio.length)
      throw new Error(
        "The WAV recording is incomplete. Its audio has not been finalized.",
      );
    if (chunk === "fmt " && size >= 16) {
      format = audio.readUInt16LE(start);
      bits = audio.readUInt16LE(start + 14);
    }
    if (chunk === "data") {
      dataBytes += size;
      if (format === 1 && bits === 16) {
        for (let i = start; i + 1 < start + size; i += 2) {
          if (audio.readInt16LE(i) !== 0) {
            nonzero = true;
            break;
          }
        }
      } else nonzero = true;
    }
    offset = start + size + (size % 2);
  }
  if (dataBytes < 1024)
    throw new Error("The WAV file contains no usable audio frames.");
  if (!nonzero)
    throw new Error(
      "The recording contains only digital silence. Check your microphone input.",
    );
}
const mimeTypes: Record<string, string> = {
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".mp4": "audio/mp4",
  ".aac": "audio/x-aac",
  ".flac": "audio/flac",
  ".ogg": "audio/ogg",
  ".webm": "audio/webm",
};
export function mimeType(path: string) {
  const mime = mimeTypes[extname(path).toLowerCase()];
  if (!mime)
    throw new Error(
      "Choose WAV, MP3, M4A, MP4, AAC, FLAC, OGG, or WebM audio.",
    );
  return mime;
}
export function recordingLimit(settings: Settings) {
  const n = Number(settings.maxSeconds ?? "300");
  if (!Number.isFinite(n) || n < 5 || n > 300)
    throw new Error("Recording limit must be between 5 and 300 seconds.");
  return n;
}
export function transcriptionRequest(
  audio: Buffer,
  mime: string,
  settings: Settings,
) {
  const vocabulary = [
    ...new Set(
      (settings.vocabulary || "")
        .split(",")
        .map((term) => term.trim())
        .filter(Boolean),
    ),
  ];
  if (vocabulary.length > 1000)
    throw new Error("Custom vocabulary supports at most 1,000 terms.");
  return {
    contents: [
      {
        role: "user",
        parts: [
          { inlineData: { mimeType: mime, data: audio.toString("base64") } },
        ],
      },
    ],
    generationConfig: {
      audioTranscriptionConfig: {
        mode: settings.style === "verbatim" ? "VERBATIM" : "SMART",
        ...(vocabulary.length ? { customVocabulary: vocabulary } : {}),
      },
    },
  };
}
export async function connection(settings: Settings) {
  const keyFilename =
    settings.credentialsFile || process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const auth = new GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
    // Raycast bundles dependencies separately. Gaxios's dynamic node-fetch
    // import resolves to a module object there; use Node's native fetch for
    // both token refresh and authenticated API requests.
    clientOptions: {
      transporterOptions: { fetchImplementation: globalThis.fetch },
    },
    ...(keyFilename ? { keyFilename } : {}),
  });
  const client = await auth.getClient();
  let project =
    settings.project?.trim() ||
    process.env.GOOGLE_CLOUD_PROJECT ||
    process.env.GCLOUD_PROJECT;
  if (!project) {
    try {
      project = await auth.getProjectId();
    } catch {
      /* User ADC often has no project_id. */
    }
  }
  if (!project) {
    try {
      const configDir =
        process.env.CLOUDSDK_CONFIG || join(homedir(), ".config", "gcloud");
      const adc = JSON.parse(
        await readFile(
          keyFilename ||
            join(configDir, "application_default_credentials.json"),
          "utf8",
        ),
      );
      project = adc.quota_project_id;
    } catch {
      /* A non-file ADC provider may not have a quota project. */
    }
  }
  if (!project)
    throw new Error(
      "Set Google Cloud Project in this extension’s preferences.",
    );
  const location = settings.location?.trim() || "global";
  const model = selectedModel(settings);
  if (
    !/^[a-z0-9][a-z0-9:.-]*$/.test(project) ||
    !/^[a-z0-9-]+$/.test(location) ||
    !/^gemini-[a-zA-Z0-9.-]+-transcribe(?:-preview(?:-[a-zA-Z0-9.-]+)?)?$/.test(
      model,
    )
  ) {
    throw new Error(
      "Use a Gemini transcription model such as gemini-3.5-transcribe-preview or gemini-3.5-transcribe, and a valid project/location. Live models require a streaming connection and cannot process these recorded files.",
    );
  }
  const host =
    location === "global"
      ? "aiplatform.googleapis.com"
      : `${location}-aiplatform.googleapis.com`;
  return {
    client,
    project,
    location,
    model,
    url: `https://${host}/v1/projects/${project}/locations/${location}/publishers/google/models/${model}:generateContent`,
  };
}
interface ModelResponse {
  promptFeedback?: { blockReason?: string };
  candidates?: {
    finishReason?: string;
    content?: {
      parts?: {
        text?: string;
        thought?: boolean;
        audioTranscription?: { text?: string };
      }[];
    };
  }[];
}
export function extractTranscript(data: ModelResponse): string {
  if (data.promptFeedback?.blockReason)
    throw new Error(
      `Gemini blocked this audio (${data.promptFeedback.blockReason}).`,
    );
  const candidate = data.candidates?.[0];
  if (!candidate)
    throw new Error("Gemini returned no transcription candidate.");
  if (candidate.finishReason !== "STOP")
    throw new Error(
      `Gemini did not finish the transcript (${candidate.finishReason || "unknown reason"}). Try a shorter recording or another model.`,
    );
  return (
    candidate.content?.parts
      ?.filter((p) => !p.thought)
      .map((p) => p.text || p.audioTranscription?.text || "")
      .join("")
      .trim() || ""
  );
}
export function friendlyError(error: unknown): string {
  // Never expose the authenticated request object, headers, or base64 audio.
  const e = error as {
    response?: { status?: number; data?: { error?: { message?: string } } };
    message?: string;
  };
  const status = e.response?.status;
  if (status === 401)
    return "ADC login expired. Run: gcloud auth application-default login";
  if (status === 403)
    return "Vertex AI denied access. Check API enablement, billing, Vertex AI User permission, and ADC quota project (serviceusage.services.use).";
  if (status === 404)
    return "This Gemini model is unavailable in the selected project/location. Change Model or Location in preferences.";
  if (status === 429)
    return "Vertex AI quota is exhausted. Wait, then retry the recording from History.";
  if (status && status >= 500)
    return "Vertex AI is temporarily unavailable. Retry from History.";
  return (
    e.response?.data?.error?.message ||
    e.message ||
    "Transcription failed."
  ).slice(0, 700);
}
export async function transcribe(path: string, settings: Settings) {
  const mime = mimeType(path);
  const info = await stat(path);
  if (!info.isFile() || info.size <= 44)
    throw new Error("Audio is empty or too short. Record a little longer.");
  if (info.size > MAX_AUDIO_BYTES)
    throw new Error(
      "Audio exceeds the 14 MiB inline limit. Trim or compress it before retrying.",
    );
  const audio = await readFile(path);
  validateAudio(audio, mime);
  const body = transcriptionRequest(audio, mime, settings);
  const conn = await connection(settings);
  const response = await conn.client.request<ModelResponse>({
    url: conn.url,
    method: "POST",
    timeout: 120_000,
    retry: false,
    data: body,
  });
  return {
    text: extractTranscript(response.data),
    project: conn.project,
    location: conn.location,
    model: conn.model,
  };
}
