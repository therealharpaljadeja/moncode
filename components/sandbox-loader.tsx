"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export type BootPhase = { key: string; label: string };
export type BootStatus = "idle" | "pending" | "ready" | "failed";

// Canonical phase order. Source of truth: lib/bootstrap.ts.
// "ready" is terminal and removes the loader, so it's not listed.
const PHASES: ReadonlyArray<{ key: string; label: string }> = [
  { key: "preflight", label: "Validate API key" },
  { key: "creating-sandbox", label: "Allocate sandbox" },
  { key: "writing-files", label: "Write starter files" },
  { key: "installing-deps", label: "Install dependencies" },
  { key: "installing-sdk", label: "Install Agent SDK" },
  { key: "cloning-skills", label: "Fetch Monad skills" },
  { key: "starting-server", label: "Start dev server" },
  { key: "waiting-preview", label: "Open preview" },
];

type PhaseTiming = { key: string; startedAt: number; endedAt?: number };

export function SandboxLoader({
  phase,
  status,
  error,
}: {
  phase: BootPhase | null;
  status: BootStatus;
  error: string | null;
}) {
  const startedAtRef = useRef<number>(Date.now());
  const [timings, setTimings] = useState<PhaseTiming[]>([]);
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    if (!phase) return;
    const phaseKey = phase.key;
    setTimings((prev) => {
      const t = Date.now();
      const last = prev[prev.length - 1];
      if (last?.key === phaseKey) return prev;
      const next = last && last.endedAt == null
        ? [...prev.slice(0, -1), { ...last, endedAt: t }]
        : [...prev];
      next.push({ key: phaseKey, startedAt: t });
      return next;
    });
  }, [phase?.key]);

  useEffect(() => {
    if (status !== "ready" && status !== "failed") return;
    setTimings((prev) => {
      const last = prev[prev.length - 1];
      if (!last || last.endedAt != null) return prev;
      return [...prev.slice(0, -1), { ...last, endedAt: Date.now() }];
    });
  }, [status]);

  useEffect(() => {
    if (status === "ready" || status === "failed") return;
    const id = window.setInterval(() => setNow(Date.now()), 200);
    return () => window.clearInterval(id);
  }, [status]);

  const failed = status === "failed";
  const currentIndex = phase
    ? PHASES.findIndex((p) => p.key === phase.key)
    : -1;
  const timingByKey = new Map(timings.map((t) => [t.key, t]));
  const completedCount = PHASES.reduce(
    (acc, p, i) =>
      i < currentIndex || (timingByKey.get(p.key)?.endedAt != null && !failed)
        ? acc + 1
        : acc,
    0,
  );

  const activeTiming =
    currentIndex >= 0 ? timingByKey.get(PHASES[currentIndex].key) : null;
  const partial =
    !failed && activeTiming && activeTiming.endedAt == null ? 0.5 : 0;
  const progress = Math.min(
    1,
    (completedCount + partial) / PHASES.length,
  );

  const elapsedMs = now - startedAtRef.current;

  return (
    <section className="flex h-full min-h-0 items-center justify-center p-8">
      <div className="w-full max-w-md rounded-2xl border bg-card shadow-sm">
        <div className="px-5 pt-5 pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-foreground">Sandbox</h2>
              <span className="rounded-md bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                node22
              </span>
            </div>
            <div className="flex items-center gap-1.5 text-xs">
              <span
                className={cn(
                  "font-medium",
                  failed ? "text-destructive" : "text-emerald-500",
                )}
              >
                {failed ? "Failed" : "Booting"}
              </span>
              <span
                className={cn(
                  "h-2 w-2 rounded-full",
                  failed ? "bg-destructive" : "bg-emerald-500 animate-pulse",
                )}
              />
            </div>
          </div>
          <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-muted">
            <div
              className={cn(
                "h-full rounded-full transition-all duration-500 ease-out",
                failed ? "bg-destructive" : "bg-emerald-500",
              )}
              style={{ width: `${Math.round(progress * 100)}%` }}
            />
          </div>
        </div>

        <ul className="mx-4 mb-4 rounded-lg border bg-muted/40 p-2 space-y-0.5">
          {PHASES.map((p, i) => {
            const timing = timingByKey.get(p.key);
            const isActive = i === currentIndex && !failed;
            const isFailed = i === currentIndex && failed;
            const isCompleted = !isActive && !isFailed && (
              i < currentIndex || timing?.endedAt != null
            );
            const isPending = !isActive && !isFailed && !isCompleted;
            const duration =
              isCompleted && timing?.endedAt != null
                ? formatMs(timing.endedAt - timing.startedAt)
                : isActive && timing
                ? formatMs(now - timing.startedAt)
                : null;
            return (
              <li
                key={p.key}
                className={cn(
                  "flex items-center justify-between rounded-md px-2 py-1.5",
                  isActive && "bg-emerald-500/10",
                  isFailed && "bg-destructive/10",
                )}
              >
                <div className="flex items-center gap-2.5 text-sm">
                  {isCompleted && (
                    <span className="flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500">
                      <Check
                        className="h-2.5 w-2.5 text-card"
                        strokeWidth={3}
                      />
                    </span>
                  )}
                  {isActive && (
                    <Loader2 className="h-4 w-4 animate-spin text-emerald-500" />
                  )}
                  {isFailed && (
                    <span className="flex h-4 w-4 items-center justify-center rounded-full bg-destructive">
                      <span className="h-0.5 w-2 rounded-full bg-card" />
                    </span>
                  )}
                  {isPending && (
                    <span className="h-4 w-4 rounded-full border border-border" />
                  )}
                  <span
                    className={cn(
                      isPending
                        ? "text-muted-foreground"
                        : "text-foreground",
                    )}
                  >
                    {p.label}
                  </span>
                </div>
                <span
                  className={cn(
                    "text-[11px] tabular-nums",
                    isCompleted
                      ? "text-muted-foreground"
                      : "text-muted-foreground/60",
                  )}
                >
                  {isActive ? "…" : duration ?? ""}
                </span>
              </li>
            );
          })}
        </ul>

        <div className="flex items-center justify-between px-5 pb-4 text-[11px] text-muted-foreground tabular-nums">
          <span>{formatElapsed(elapsedMs)}</span>
          <span className={cn("truncate pl-3", failed && "text-destructive")}>
            {failed ? error ?? "Boot failed" : "Provisioning…"}
          </span>
        </div>
      </div>
    </section>
  );
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function formatElapsed(ms: number): string {
  return `${(ms / 1000).toFixed(2)}s`;
}
