import { NextResponse } from "next/server";
import { readSessionId } from "@/lib/session";
import { SANDBOX_CWD, getSession } from "@/lib/sandbox";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SKIP_DIRS = new Set([
  "node_modules",
  ".next",
  ".git",
  ".claude-plugins",
  ".claude",
]);

const MAX_ENTRIES = 2000;

type FileNode = {
  name: string;
  path: string;
  type: "file" | "dir";
  children?: FileNode[];
};

export async function GET() {
  const sessionId = await readSessionId();
  if (!sessionId) {
    return NextResponse.json({ error: "no session" }, { status: 400 });
  }
  const session = getSession(sessionId);
  if (!session || session.bootStatus !== "ready" || !session.sandbox) {
    return NextResponse.json({ tree: [] });
  }

  const counter = { value: 0 };
  try {
    const tree = await walk(session.sandbox.fs, SANDBOX_CWD, "", counter);
    return NextResponse.json({ tree });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

type SandboxFs = {
  readdir(
    path: string,
    opts: { withFileTypes: true },
  ): Promise<Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>>;
};

async function walk(
  fs: SandboxFs,
  abs: string,
  rel: string,
  counter: { value: number },
): Promise<FileNode[]> {
  if (counter.value >= MAX_ENTRIES) return [];

  const entries = await fs.readdir(abs, { withFileTypes: true });
  entries.sort((a, b) => {
    const aDir = a.isDirectory() ? 0 : 1;
    const bDir = b.isDirectory() ? 0 : 1;
    if (aDir !== bDir) return aDir - bDir;
    return a.name.localeCompare(b.name);
  });

  const out: FileNode[] = [];
  for (const entry of entries) {
    if (counter.value >= MAX_ENTRIES) break;
    if (SKIP_DIRS.has(entry.name)) continue;
    if (entry.name.startsWith(".") && entry.name !== ".env.example") continue;

    const childAbs = `${abs}/${entry.name}`;
    const childRel = rel ? `${rel}/${entry.name}` : entry.name;

    if (entry.isDirectory()) {
      counter.value += 1;
      const children = await walk(fs, childAbs, childRel, counter);
      out.push({
        name: entry.name,
        path: childRel,
        type: "dir",
        children,
      });
    } else if (entry.isFile()) {
      counter.value += 1;
      out.push({ name: entry.name, path: childRel, type: "file" });
    }
  }

  return out;
}
