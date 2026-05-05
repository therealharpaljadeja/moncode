import { readSessionId } from "@/lib/session";
import { getSession } from "@/lib/sandbox";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function sse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function GET() {
  const sessionId = await readSessionId();
  if (!sessionId) {
    return new Response("no session", { status: 400 });
  }
  const session = getSession(sessionId);
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

      // Replay buffered log first.
      for (const line of session.bootLog) {
        safeEnqueue(sse("log", { line }));
      }

      const listener = (line: string) => {
        safeEnqueue(sse("log", { line }));
      };
      session.bootListeners.add(listener);

      const finalize = () => {
        session.bootListeners.delete(listener);
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
