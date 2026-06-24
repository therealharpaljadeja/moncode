"use client";

import { usePrivy } from "@privy-io/react-auth";
import { FolderKanban, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { AuthGate } from "@/components/auth-gate";
import { WalletBadge } from "@/components/wallet-badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { useAuthFetch } from "@/hooks/use-auth-fetch";

type ProjectSummary = {
  id: string;
  title: string | null;
  createdAt: number;
  updatedAt: number;
};

export default function ProjectsPage() {
  return (
    <AuthGate>
      <ProjectsHub />
    </AuthGate>
  );
}

function ProjectsHub() {
  const authFetch = useAuthFetch();
  const router = useRouter();
  const { logout } = usePrivy();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadProjects = useCallback(async () => {
    setError(null);
    const res = await authFetch("/api/projects");
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setError(data.error ?? "Could not load your projects.");
      setProjects([]);
      return;
    }
    const data = (await res.json()) as { projects?: ProjectSummary[] };
    setProjects(Array.isArray(data.projects) ? data.projects : []);
  }, [authFetch]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      await loadProjects();
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [loadProjects]);

  const createProject = useCallback(async () => {
    if (creating) return;
    setCreating(true);
    setError(null);
    try {
      const res = await authFetch("/api/projects", { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as ProjectSummary & {
        error?: string;
      };
      if (!res.ok) {
        setError(data.error ?? "Could not create a new project.");
        return;
      }
      if (!data.id) {
        setError("Could not create a new project.");
        return;
      }
      router.push(`/project/${data.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create a new project.");
    } finally {
      setCreating(false);
    }
  }, [authFetch, creating, router]);

  return (
    <div className="min-h-screen bg-background">
      <header className="flex h-14 items-center gap-3 border-b px-6">
        <div className="flex items-center gap-2 font-semibold">
          <FolderKanban className="size-4 text-muted-foreground" />
          Moncode
        </div>
        <div className="flex-1" />
        <Button asChild variant="ghost" size="sm">
          <Link href="/connections">Connections</Link>
        </Button>
        <WalletBadge />
        <Button variant="ghost" size="sm" onClick={() => logout()}>
          Sign out
        </Button>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-10">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">
              Your projects
            </h1>
            <p className="text-sm text-muted-foreground">
              Pick up where you left off or start a new Monad dApp.
            </p>
          </div>
          <Button onClick={() => void createProject()} disabled={creating}>
            {creating ? (
              <Spinner className="mr-2 size-4" />
            ) : (
              <Plus className="mr-2 size-4" />
            )}
            New project
          </Button>
        </div>

        {error && (
          <p className="mb-6 text-sm text-destructive-foreground">{error}</p>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-24">
            <Spinner className="size-6 text-muted-foreground" />
          </div>
        ) : projects.length === 0 ? (
          <Card className="border-dashed">
            <CardHeader>
              <CardTitle className="text-base">No projects yet</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Create your first project to spin up a sandbox and start
                vibe-coding.
              </p>
              <Button onClick={() => void createProject()} disabled={creating}>
                <Plus className="mr-2 size-4" />
                Create project
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((project) => (
              <Link
                key={project.id}
                href={`/project/${project.id}`}
                className="group block rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Card className="h-full transition-colors group-hover:border-foreground/20 group-hover:bg-muted/20">
                  <CardHeader className="pb-3">
                    <CardTitle className="line-clamp-2 text-base">
                      {project.title ?? "Untitled project"}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-xs text-muted-foreground">
                      Updated {formatRelativeTime(project.updatedAt)}
                    </p>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString();
}
