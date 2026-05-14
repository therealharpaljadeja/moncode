import type { Sandbox } from "@vercel/sandbox";

export type BootListener = (line: string) => void;

export type BootPhase = {
  key: string;
  label: string;
};

export type BootPhaseListener = (phase: BootPhase) => void;

export type Session = {
  cookieSessionId: string;
  // null while bootPromise is still awaiting Sandbox.create. Becomes non-null
  // before bootStatus transitions to "ready".
  sandbox: Sandbox | null;
  sandboxUrl: string;
  agentSessionId: string | null;
  bootPromise: Promise<void>;
  bootStatus: "pending" | "ready" | "failed";
  // Raw command output — kept as a debug buffer, not surfaced to the UI.
  bootLog: string[];
  bootListeners: Set<BootListener>;
  // High-level, user-facing milestone. The UI renders only this.
  bootPhase: BootPhase | null;
  bootPhaseListeners: Set<BootPhaseListener>;
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
    void existing.sandbox?.stop().catch(() => {});
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

export function setBootPhase(session: Session, phase: BootPhase): void {
  session.bootPhase = phase;
  for (const listener of session.bootPhaseListeners) {
    try {
      listener(phase);
    } catch {
      // ignore listener failures
    }
  }
}

export const SANDBOX_CWD = "/vercel/sandbox";
export const APP_PORT = 3000;
