import type { Sandbox } from "@vercel/sandbox";

import { SANDBOX_CWD } from "@/lib/sandbox";

export const WORKSPACE_SKIP_DIRS = new Set([
  "node_modules",
  ".next",
  ".git",
  ".claude-plugins",
  ".claude",
  ".moncode",
]);

const MAX_FILE_BYTES = 1024 * 1024;
const MAX_FILES = 500;
const MAX_TOTAL_BYTES = 8 * 1024 * 1024;

export type WorkspaceFile = {
  path: string;
  content: Buffer;
};

type SandboxFs = {
  readdir(
    path: string,
    opts: { withFileTypes: true },
  ): Promise<Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>>;
  stat(path: string): Promise<{ size: number; isDirectory(): boolean; isFile(): boolean }>;
  readFile(path: string): Promise<Buffer>;
};

export async function collectSandboxWorkspace(
  sandbox: Sandbox,
): Promise<WorkspaceFile[]> {
  const files: WorkspaceFile[] = [];
  let totalBytes = 0;

  await walk(sandbox.fs as SandboxFs, SANDBOX_CWD, "", files, () => totalBytes, (n) => {
    totalBytes += n;
  });

  return files;
}

async function walk(
  fs: SandboxFs,
  abs: string,
  rel: string,
  out: WorkspaceFile[],
  getTotal: () => number,
  addBytes: (n: number) => void,
): Promise<void> {
  if (out.length >= MAX_FILES) return;

  const entries = await fs.readdir(abs, { withFileTypes: true });
  for (const entry of entries) {
    if (out.length >= MAX_FILES) break;
    if (WORKSPACE_SKIP_DIRS.has(entry.name)) continue;
    if (entry.name.startsWith(".") && entry.name !== ".env.example") continue;

    const childAbs = `${abs}/${entry.name}`;
    const childRel = rel ? `${rel}/${entry.name}` : entry.name;

    if (entry.isDirectory()) {
      await walk(fs, childAbs, childRel, out, getTotal, addBytes);
      continue;
    }

    if (!entry.isFile()) continue;

    const stat = await fs.stat(childAbs);
    if (stat.size > MAX_FILE_BYTES) continue;
    if (getTotal() + stat.size > MAX_TOTAL_BYTES) {
      throw new Error(
        `Workspace exceeds ${MAX_TOTAL_BYTES} byte push limit — remove large files or push a subset.`,
      );
    }

    const content = await fs.readFile(childAbs);
    out.push({ path: childRel, content });
    addBytes(content.byteLength);
  }
}
