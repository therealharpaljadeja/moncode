import type { Sandbox } from "@vercel/sandbox";

export type BootListener = (line: string) => void;

export type Session = {
  sandbox: Sandbox;
  sandboxUrl: string;
  agentSessionId: string | null;
  bootPromise: Promise<void>;
  bootStatus: "pending" | "ready" | "failed";
  bootLog: string[];
  bootListeners: Set<BootListener>;
  bootError?: string;
};

type GlobalCache = {
  sessions: Map<string, Session>;
};

const globalRef = globalThis as unknown as { __moncode?: GlobalCache };

function cache(): GlobalCache {
  if (!globalRef.__moncode) {
    globalRef.__moncode = { sessions: new Map() };
  }
  return globalRef.__moncode;
}

export function getSession(sessionId: string): Session | undefined {
  return cache().sessions.get(sessionId);
}

export function setSession(sessionId: string, session: Session): void {
  cache().sessions.set(sessionId, session);
}

export function deleteSession(sessionId: string): void {
  const existing = cache().sessions.get(sessionId);
  if (existing) {
    void existing.sandbox.stop().catch(() => {});
    cache().sessions.delete(sessionId);
  }
}

export function appendBootLog(session: Session, line: string): void {
  session.bootLog.push(line);
  for (const listener of session.bootListeners) {
    try {
      listener(line);
    } catch {
      // ignore listener failures
    }
  }
}

export const SANDBOX_CWD = "/vercel/sandbox";
export const APP_PORT = 3000;
