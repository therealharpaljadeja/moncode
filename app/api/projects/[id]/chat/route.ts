import { NextResponse } from "next/server";

import { requireOwnedProject } from "@/lib/auth";
import { runAgentTurn } from "@/lib/agent-runner";
import { getSession } from "@/lib/sandbox";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

function sse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function POST(req: Request, context: RouteContext) {
  const { id: projectId } = await context.params;
  const owned = await requireOwnedProject(req, projectId);
  if (owned instanceof NextResponse) return owned;

  const session = getSession(projectId);
  if (!session) {
    return new Response("no sandbox", { status: 404 });
  }

  let body: { message?: unknown };
  try {
    body = await req.json();
  } catch {
    return new Response("invalid JSON", { status: 400 });
  }
  const prompt = body?.message;
  if (typeof prompt !== "string" || prompt.trim().length === 0) {
    return new Response("message is required", { status: 400 });
  }

  const encoder = new TextEncoder();
  const abort = new AbortController();
  req.signal.addEventListener("abort", () => abort.abort());

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          closed = true;
        }
      };

      try {
        if (session.bootStatus === "pending") {
          send(sse("waiting", { reason: "booting" }));
          await session.bootPromise;
        }
        if (session.bootStatus !== "ready") {
          send(
            sse("error", {
              message: session.bootError ?? "sandbox is not ready",
            }),
          );
          controller.close();
          return;
        }

        for await (const event of runAgentTurn(
          session,
          prompt,
          abort.signal,
        )) {
          send(sse(event.type, event));
        }

        send(sse("done", { agentSessionId: session.agentSessionId }));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        send(sse("error", { message: msg }));
      } finally {
        if (!closed) {
          closed = true;
          try {
            controller.close();
          } catch {
            // already closed
          }
        }
      }
    },
    cancel() {
      abort.abort();
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
