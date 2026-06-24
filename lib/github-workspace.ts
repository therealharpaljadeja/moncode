import type { WorkspaceFile } from "@/lib/sandbox-workspace";
import { getGithubAccessToken } from "@/lib/github";

type GithubHeaders = Record<string, string>;

function githubHeaders(token: string): GithubHeaders {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "Content-Type": "application/json",
  };
}

async function githubJson<T>(
  url: string,
  token: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { ...githubHeaders(token), ...init?.headers },
  });
  if (!res.ok) {
    let detail = "";
    try {
      const body = (await res.json()) as { message?: string };
      detail = body.message ? `: ${body.message}` : "";
    } catch {
      // ignore
    }
    throw new Error(`GitHub API error (${res.status})${detail}`);
  }
  return res.json() as Promise<T>;
}

export type PushWorkspaceInput = {
  owner: string;
  repo: string;
  branch?: string;
  message: string;
};

export type PushWorkspaceResult = {
  branch: string;
  commitSha: string;
  filesPushed: number;
  htmlUrl: string;
};

export async function pushWorkspaceToGithub(
  userId: string,
  files: WorkspaceFile[],
  input: PushWorkspaceInput,
): Promise<PushWorkspaceResult> {
  if (files.length === 0) {
    throw new Error("No files to push — workspace is empty.");
  }

  const token = await getGithubAccessToken(userId);
  const owner = input.owner;
  const repo = input.repo;
  const branch = input.branch ?? "main";
  const base = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;

  let parentCommitSha: string | null = null;
  let baseTreeSha: string | null = null;

  try {
    const ref = await githubJson<{ object: { sha: string } }>(
      `${base}/git/ref/heads/${encodeURIComponent(branch)}`,
      token,
    );
    parentCommitSha = ref.object.sha;
    const commit = await githubJson<{ tree: { sha: string } }>(
      `${base}/git/commits/${parentCommitSha}`,
      token,
    );
    baseTreeSha = commit.tree.sha;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes("(404)")) throw err;
  }

  const treeItems: Array<{
    path: string;
    mode: "100644";
    type: "blob";
    sha: string;
  }> = [];

  for (const file of files) {
    const blob = await githubJson<{ sha: string }>(`${base}/git/blobs`, token, {
      method: "POST",
      body: JSON.stringify({
        content: file.content.toString("base64"),
        encoding: "base64",
      }),
    });
    treeItems.push({
      path: file.path,
      mode: "100644",
      type: "blob",
      sha: blob.sha,
    });
  }

  const tree = await githubJson<{ sha: string }>(`${base}/git/trees`, token, {
    method: "POST",
    body: JSON.stringify({
      base_tree: baseTreeSha ?? undefined,
      tree: treeItems,
    }),
  });

  const commit = await githubJson<{ sha: string; html_url: string }>(
    `${base}/git/commits`,
    token,
    {
      method: "POST",
      body: JSON.stringify({
        message: input.message,
        tree: tree.sha,
        parents: parentCommitSha ? [parentCommitSha] : [],
      }),
    },
  );

  if (parentCommitSha) {
    await githubJson(
      `${base}/git/refs/heads/${encodeURIComponent(branch)}`,
      token,
      {
        method: "PATCH",
        body: JSON.stringify({ sha: commit.sha, force: false }),
      },
    );
  } else {
    await githubJson(`${base}/git/refs`, token, {
      method: "POST",
      body: JSON.stringify({
        ref: `refs/heads/${branch}`,
        sha: commit.sha,
      }),
    });
  }

  return {
    branch,
    commitSha: commit.sha,
    filesPushed: files.length,
    htmlUrl: commit.html_url,
  };
}
