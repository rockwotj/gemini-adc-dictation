import {
  mkdir,
  readFile,
  writeFile,
  rename,
  rm,
  readdir,
  stat,
} from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

export interface Session {
  id: string;
  created: string;
  status: "pending" | "done" | "failed";
  audio: string;
  ownedAudio: boolean;
  target?: string;
  text?: string;
  error?: string;
  model?: string;
}
export async function readJSON<T>(path: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return;
    throw e;
  }
}
export async function writeJSON(path: string, data: unknown) {
  const tmp = `${path}.${randomUUID()}.tmp`;
  await writeFile(tmp, JSON.stringify(data), { mode: 0o600 });
  await rename(tmp, path);
}
export class Store {
  constructor(public root: string) {}
  dir(id: string) {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error("Invalid recording ID.");
    return join(this.root, "sessions", id);
  }
  async initialize() {
    await mkdir(join(this.root, "sessions"), { recursive: true, mode: 0o700 });
  }
  async withLock<T>(action: () => Promise<T>): Promise<T> {
    await this.initialize();
    const lock = join(this.root, "operation.lock");
    const token = randomUUID();
    try {
      await writeFile(lock, token, { flag: "wx", mode: 0o600 });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      const age = Date.now() - (await stat(lock)).mtimeMs;
      if (age > 10 * 60_000) {
        await rm(lock, { force: true });
        return this.withLock(action);
      }
      throw new Error(
        "Dictation is already starting or transcribing. Wait for it to finish. An interrupted operation unlocks after 10 minutes.",
      );
    }
    try {
      return await action();
    } finally {
      if ((await readFile(lock, "utf8").catch(() => "")) === token)
        await rm(lock, { force: true });
    }
  }
  async create(audio?: string, target?: string): Promise<Session> {
    await this.initialize();
    const id = randomUUID();
    const dir = this.dir(id);
    await mkdir(dir, { mode: 0o700 });
    const session: Session = {
      id,
      created: new Date().toISOString(),
      status: "pending",
      audio: audio || join(dir, "audio.wav"),
      ownedAudio: !audio,
      target,
    };
    await this.save(session);
    return session;
  }
  async save(session: Session) {
    await writeJSON(join(this.dir(session.id), "meta.json"), session);
  }
  async current() {
    const pointer = await readJSON<{ id: string }>(
      join(this.root, "current.json"),
    );
    return pointer
      ? readJSON<Session>(join(this.dir(pointer.id), "meta.json"))
      : undefined;
  }
  async setCurrent(session?: Session) {
    if (session)
      await writeJSON(join(this.root, "current.json"), { id: session.id });
    else await rm(join(this.root, "current.json"), { force: true });
  }
  async list() {
    await this.initialize();
    const entries = await readdir(join(this.root, "sessions"));
    const sessions = await Promise.all(
      entries
        .filter((id) => /^[a-f0-9-]{36}$/.test(id))
        .map((id) => readJSON<Session>(join(this.dir(id), "meta.json"))),
    );
    return sessions
      .filter((s): s is Session => !!s)
      .sort((a, b) => b.created.localeCompare(a.created));
  }
  async remove(session: Session) {
    await rm(this.dir(session.id), { recursive: true, force: true });
  }
}
