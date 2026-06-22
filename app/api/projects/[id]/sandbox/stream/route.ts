import { NextResponse } from "next/server";

import { requireOwnedProject } from "@/lib/auth";
import { getSession } from "@/lib/sandbox";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

function sse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function GET(req: Request, context: RouteContext) {
  const { id: projectId } = await context.params;
  const owned = await requireOwnedProject(req, projectId);
  if (owned instanceof NextResponse) return owned;

  const session = getSession(projectId);
  if (!session) {
    return new Response("no sandbox", { status: 404 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const safeEnqueue = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          closed = true;
        }
      };

      if (session.bootPhase) {
        safeEnqueue(sse("phase", session.bootPhase));
      }

      const phaseListener = (phase: { key: string; label: string }) => {
        safeEnqueue(sse("phase", phase));
      };
      session.bootPhaseListeners.add(phaseListener);

      const finalize = () => {
        session.bootPhaseListeners.delete(phaseListener);
        safeEnqueue(
          sse("status", {
            status: session.bootStatus,
            sandboxUrl:
              session.bootStatus === "ready" ? session.sandboxUrl : null,
            bootError: session.bootError ?? null,
          }),
        );
        if (!closed) {
          closed = true;
          try {
            controller.close();
          } catch {
            // already closed
          }
        }
      };

      if (session.bootStatus !== "pending") {
        finalize();
        return;
      }

      session.bootPromise
        .then(() => finalize())
        .catch(() => finalize());
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
