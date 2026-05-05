import { cookies } from "next/headers";
import { randomBytes } from "crypto";

const COOKIE_NAME = "moncode_session";

export async function getOrCreateSessionId(): Promise<string> {
  const jar = await cookies();
  const existing = jar.get(COOKIE_NAME)?.value;
  if (existing) return existing;
  const id = randomBytes(16).toString("hex");
  jar.set(COOKIE_NAME, id, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24,
  });
  return id;
}

export async function readSessionId(): Promise<string | null> {
  const jar = await cookies();
  return jar.get(COOKIE_NAME)?.value ?? null;
}
