import path from "path";
import fs from "fs/promises";
import { randomBytes } from "crypto";

export type StoredSession = {
  sandboxId: string;
  agentSessionId: string | null;
  createdAt: number;
  title: string | null;
};

type StoreFile = { version: 1; sessions: Record<string, StoredSession> };

const STATE_DIR = path.join(process.cwd(), ".moncode-state");
const STORE_PATH = path.join(STATE_DIR, "sessions.json");

let cache: StoreFile | null = null;
let writeChain: Promise<void> = Promise.resolve();

async function readStore(): Promise<StoreFile> {
  if (cache) return cache;
  try {
    const raw = await fs.readFile(STORE_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<StoreFile>;
    if (parsed && parsed.version === 1 && parsed.sessions) {
      cache = { version: 1, sessions: parsed.sessions };
      return cache;
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      // corrupted file — start fresh rather than crash
    }
  }
  cache = { version: 1, sessions: {} };
  return cache;
}

async function writeStore(next: StoreFile): Promise<void> {
  await fs.mkdir(STATE_DIR, { recursive: true });
  const tmp = `${STORE_PATH}.${randomBytes(6).toString("hex")}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(next, null, 2), "utf8");
  await fs.rename(tmp, STORE_PATH);
  cache = next;
}

export async function getStored(
  cookieId: string,
): Promise<StoredSession | undefined> {
  const store = await readStore();
  return store.sessions[cookieId];
}

export function upsertStored(
  cookieId: string,
  patch: Partial<StoredSession> & { sandboxId?: string },
): Promise<void> {
  writeChain = writeChain.then(async () => {
    const store = await readStore();
    const prev = store.sessions[cookieId];
    const merged: StoredSession = {
      sandboxId: patch.sandboxId ?? prev?.sandboxId ?? "",
      agentSessionId:
        patch.agentSessionId !== undefined
          ? patch.agentSessionId
          : (prev?.agentSessionId ?? null),
      createdAt: prev?.createdAt ?? patch.createdAt ?? Date.now(),
      title:
        patch.title !== undefined ? patch.title : (prev?.title ?? null),
    };
    if (!merged.sandboxId) return;
    const next: StoreFile = {
      version: 1,
      sessions: { ...store.sessions, [cookieId]: merged },
    };
    await writeStore(next);
  });
  return writeChain;
}

export function removeStored(cookieId: string): Promise<void> {
  writeChain = writeChain.then(async () => {
    const store = await readStore();
    if (!(cookieId in store.sessions)) return;
    const nextSessions = { ...store.sessions };
    delete nextSessions[cookieId];
    await writeStore({ version: 1, sessions: nextSessions });
  });
  return writeChain;
}
